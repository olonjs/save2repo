import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { resolveCorrelationId } from "@/lib/licensing";
import { readTenantContent } from "@/lib/tenantContentStore";
import { tenantContentPayloadToRepoFiles } from "@/lib/saveStoreToRepoMap";
import { executeCommitBuildDeploy } from "@/lib/saveRepoCommitDeploy";
import { isSave2RoutesBetaEnabled, isSaveRepoEnabled } from "@/lib/saveFeatureFlags";
import { logSaveError, metricSave } from "@/lib/saveTelemetry";

export const dynamic = "force-dynamic";

type GatherStepId = "gather_store";
type PipelineStepId = "commit" | "build" | "live";
type ColdSaveStepId = GatherStepId | PipelineStepId;
type StepStatus = "running" | "done";

type TenantRecord = {
  id: string;
  owner_id: string;
  slug: string;
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

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };
      const sendStep = (id: ColdSaveStepId, status: StepStatus, label?: string) => {
        send("step", label ? { id, status, label } : { id, status });
      };
      const sendLog = (stepId: ColdSaveStepId, message: string) => {
        send("log", { stepId, message });
      };
      const sendError = (message: string, code?: string, stepId?: ColdSaveStepId) => {
        send("error", { message, correlationId, ...(code ? { code } : {}), ...(stepId ? { stepId } : {}) });
      };

      try {
        if (!isSave2RoutesBetaEnabled() || !isSaveRepoEnabled()) {
          sendError("Cold save is disabled by feature flags", "ERR_COLD_SAVE_DISABLED");
          controller.close();
          return;
        }

        const auth = await requireRequestUser(req);
        if (!auth.ok) {
          sendError(auth.data.error, "ERR_UNAUTHORIZED");
          controller.close();
          return;
        }

        const access = await assertTenantAccess({
          userId: auth.data.user.id,
          tenantId: params.id,
          requiredRole: "owner",
        });
        if (!access.ok) {
          sendError(access.data.error, access.data.code);
          controller.close();
          return;
        }

        const body = (await req.json().catch(() => ({}))) as { message?: string };
        const commitMessage = body.message?.trim() || "Cold save: Supabase → repository [build]";

        const supabaseAdmin = getSupabaseAdmin();
        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,owner_id,slug,github_installation_id,github_repo_owner,github_repo_name,vercel_project_id,unsynced_changes_count")
          .eq("id", params.id)
          .single<TenantRecord>();

        if (tenantError || !tenant) {
          sendError("Tenant not found", "ERR_TENANT_NOT_FOUND");
          controller.close();
          return;
        }
        if (!tenant.github_installation_id) {
          sendError("GitHub App installation missing for tenant", "ERR_GITHUB_INSTALLATION_MISSING");
          controller.close();
          return;
        }
        if (!tenant.vercel_project_id) {
          sendError("Missing Vercel project on tenant", "ERR_VERCEL_PROJECT_MISSING");
          controller.close();
          return;
        }

        sendStep("gather_store", "running", "Reading Supabase content store");
        sendLog("gather_store", "Loading tenant_content_store…");
        const payload = await readTenantContent(tenant.id);
        if (!payload) {
          sendError("No content in Supabase store for this tenant", "ERR_STORE_EMPTY", "gather_store");
          controller.close();
          return;
        }
        const files = tenantContentPayloadToRepoFiles(payload);
        if (files.length === 0) {
          sendError("Store payload produced no files to commit", "ERR_STORE_EMPTY", "gather_store");
          controller.close();
          return;
        }
        sendLog("gather_store", `Resolved ${files.length} file(s) from store.`);
        sendStep("gather_store", "done");

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
          sendStep: (id, status, label) => sendStep(id, status, label),
          telemetry: { operation: "cold_save", correlationId },
        });

        if (!pipelineResult.ok) {
          sendError(pipelineResult.message, pipelineResult.code, pipelineResult.stepId);
          controller.close();
          return;
        }

        send("done", {
          correlationId,
          tenantId: tenant.id,
          deployUrl: pipelineResult.deployUrl,
          commitSha: pipelineResult.commitSha,
          syncedAt: pipelineResult.syncedAt,
          filesWritten: pipelineResult.filesCount,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cold save failed";
        metricSave("cold_save_error", 1, { internal: true });
        logSaveError("cold_save.failed", { correlationId, message });
        send("error", { message, code: "ERR_COLD_SAVE_INTERNAL", correlationId });
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
