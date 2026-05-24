import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";
import { edgeItemsToRepoFiles, edgeItemsToRepoFilesForNamespace } from "@/lib/saveJspMap";
import { edgeNamespaceFromTenantId, readAllEdgeItems, resolveRuntimeEdgeConfigId } from "@/lib/saveEdgeConfig";
import { isSave2RoutesBetaEnabled, isSaveRepoEnabled } from "@/lib/saveFeatureFlags";
import { logSaveError, metricSave } from "@/lib/saveTelemetry";
import { executeCommitBuildDeploy } from "@/lib/saveRepoCommitDeploy";

export const dynamic = "force-dynamic";

type StepId = "gather" | "commit" | "build" | "live";
type StepStatus = "running" | "done";

type Save2RepoBody = { message?: string };

type TenantRecord = {
  id: string;
  slug: string;
  api_key: string;
  github_installation_id: string | null;
  github_repo_owner: string;
  github_repo_name: string;
  vercel_project_id: string | null;
  unsynced_changes_count: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseBearerApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };
      const sendStep = (id: StepId, status: StepStatus, label?: string) => {
        send("step", label ? { id, status, label } : { id, status });
      };
      const sendLog = (stepId: StepId, message: string) => {
        send("log", { stepId, message });
      };
      const sendError = (message: string, code?: string, stepId?: StepId) => {
        send("error", { message, ...(code ? { code } : {}), ...(stepId ? { stepId } : {}), correlationId });
      };

      try {
        if (!isSave2RoutesBetaEnabled() || !isSaveRepoEnabled()) {
          sendError("save2repo is disabled by feature flags", "ERR_SAVE2REPO_DISABLED");
          controller.close();
          return;
        }

        const apiKey = parseBearerApiKey(req);
        if (!apiKey) {
          sendError("Unauthorized", "ERR_UNAUTHORIZED");
          controller.close();
          return;
        }
        const body = (await req.json().catch(() => ({}))) as Save2RepoBody;
        const commitMessage = body.message?.trim() || "Production Sync: [Consolidated Updates] [build]";

        const supabaseAdmin = getSupabaseAdmin();
        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,slug,api_key,github_installation_id,github_repo_owner,github_repo_name,vercel_project_id,unsynced_changes_count")
          .eq("api_key", apiKey)
          .single<TenantRecord>();

        if (tenantError || !tenant) {
          sendError("Invalid API Key", "ERR_INVALID_API_KEY");
          controller.close();
          return;
        }
        if (!tenant.github_installation_id) {
          sendError("GitHub App not installed for tenant", "ERR_GITHUB_INSTALLATION_MISSING");
          controller.close();
          return;
        }
        if (!tenant.vercel_project_id) {
          sendError("Missing Vercel project on tenant", "ERR_VERCEL_PROJECT_MISSING");
          controller.close();
          return;
        }
        sendStep("gather", "running", "Gathering hot truth");
        sendLog("gather", "Reading full tenant state from Edge Config...");
        const edgeConfigId = resolveRuntimeEdgeConfigId();
        const edgeItems = await readAllEdgeItems(edgeConfigId);
        const edgeNamespace = edgeNamespaceFromTenantId(tenant.id);
        let files = edgeItemsToRepoFilesForNamespace(edgeItems, edgeNamespace);
        // Backward compatibility: old unscoped keys.
        if (files.length === 0) {
          files = edgeItemsToRepoFiles(edgeItems);
        }
        if (files.length === 0) {
          sendError("No hot data found in Edge Config", "ERR_EDGE_EMPTY", "gather");
          controller.close();
          return;
        }
        sendLog("gather", `Resolved ${files.length} files from Edge.`);
        sendStep("gather", "done");

        const pipelineResult = await executeCommitBuildDeploy({
          files,
          tenant: {
            id: tenant.id,
            github_installation_id: tenant.github_installation_id,
            github_repo_owner: tenant.github_repo_owner,
            github_repo_name: tenant.github_repo_name,
            vercel_project_id: tenant.vercel_project_id,
            unsynced_changes_count: tenant.unsynced_changes_count,
          },
          commitMessage,
          correlationId,
          supabaseAdmin,
          sendLog: (stepId, message) => sendLog(stepId, message),
          sendStep: (id, status, label) => sendStep(id as StepId, status, label),
          telemetry: { operation: "save2repo", correlationId },
        });

        if (!pipelineResult.ok) {
          sendError(pipelineResult.message, pipelineResult.code, pipelineResult.stepId as StepId | undefined);
          controller.close();
          return;
        }
        send("done", {
          deployUrl: pipelineResult.deployUrl,
          commitSha: pipelineResult.commitSha,
          syncedAt: pipelineResult.syncedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "save2repo failed";
        send("error", { message, code: "ERR_SAVE2REPO_INTERNAL" });
        logSaveError("save2repo.failed", {
          message,
        });
        metricSave("save2repo_error", 1, { internal: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
    },
  });
}

