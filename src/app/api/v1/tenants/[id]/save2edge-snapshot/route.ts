import { NextRequest } from "next/server";
import { App } from "octokit";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { resolveCorrelationId } from "@/lib/licensing";
import { mapRepoJsonFilesToEdgeEntries } from "@/lib/saveRepoToEdgeMap";
import { replaceTenantContent, tenantNamespaceFromId, type TenantContentPayload } from "@/lib/tenantContentStore";
import { logSaveError, logSaveInfo, metricSave } from "@/lib/saveTelemetry";
import { isSave2RoutesBetaEnabled } from "@/lib/saveFeatureFlags";

export const dynamic = "force-dynamic";

type StepId = "gather_repo" | "map_content" | "write_store" | "finalize";
type StepStatus = "running" | "done";

type TenantRecord = {
  id: string;
  owner_id: string;
  slug: string;
  github_installation_id: string | null;
  github_repo_owner: string;
  github_repo_name: string;
};

type RepoContentFile = {
  path?: string;
  type?: string;
  sha?: string;
  content?: string;
  encoding?: string;
};

type GitHubOctokitLike = {
  rest: {
    repos: {
      getContent: (params: { owner: string; repo: string; path: string }) => Promise<{ data: unknown }>;
    };
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function getRepoJsonFile(octokit: GitHubOctokitLike, owner: string, repo: string, path: string) {
  const response = await octokit.rest.repos.getContent({ owner, repo, path });
  if (Array.isArray(response.data)) {
    throw new Error(`Expected file but found directory at ${path}`);
  }
  const data = response.data as RepoContentFile;
  const raw = typeof data.content === "string" ? Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8") : "";
  return JSON.parse(raw) as unknown;
}

// replace current listRepoPagePaths with this recursive version
async function listRepoPagePaths(
  octokit: GitHubOctokitLike,
  owner: string,
  repo: string,
  startPath = "src/data/pages"
): Promise<string[]> {
  const stack: string[] = [startPath];
  const out: string[] = [];

  while (stack.length > 0) {
    const currentPath = stack.pop()!;
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: currentPath,
    });

    if (Array.isArray(response.data)) {
      for (const entry of response.data) {
        const entryPath = typeof entry.path === "string" ? entry.path : null;
        if (!entryPath) continue;

        if (entry.type === "dir") {
          stack.push(entryPath);
          continue;
        }

        if (entry.type === "file" && entryPath.endsWith(".json")) {
          out.push(entryPath);
        }
      }
      continue;
    }

    // edge case: startPath points directly to a file
    const single = response.data as RepoContentFile;
    if (typeof single.path === "string" && single.path.endsWith(".json")) {
      out.push(single.path);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
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
      const sendStep = (id: StepId, status: StepStatus, label?: string) => {
        send("step", label ? { id, status, label } : { id, status });
      };
      const sendLog = (stepId: StepId, message: string) => {
        send("log", { stepId, message });
      };
      const sendError = (message: string, code?: string, stepId?: StepId) => {
        send("error", { message, correlationId, ...(code ? { code } : {}), ...(stepId ? { stepId } : {}) });
      };

      try {
        if (!isSave2RoutesBetaEnabled()) {
          sendError("save2 routes are disabled by feature flags", "ERR_SAVE2EDGE_DISABLED");
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

        const supabaseAdmin = getSupabaseAdmin();
        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,owner_id,slug,github_installation_id,github_repo_owner,github_repo_name")
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

        sendStep("gather_repo", "running", "Reading repository JSON files");
        const app = new App({
          appId: process.env.GITHUB_APP_ID!,
          privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        });
        const octokit = await app.getInstallationOctokit(Number(tenant.github_installation_id));

        const siteContent = await getRepoJsonFile(
          octokit,
          tenant.github_repo_owner,
          tenant.github_repo_name,
          "src/data/config/site.json"
        );
        const pagePaths = await listRepoPagePaths(octokit, tenant.github_repo_owner, tenant.github_repo_name);
        const pageFiles = await Promise.all(
          pagePaths.map(async (path) => ({
            path,
            content: await getRepoJsonFile(octokit, tenant.github_repo_owner, tenant.github_repo_name, path),
          }))
        );
        const files = [{ path: "src/data/config/site.json", content: siteContent }, ...pageFiles];
        sendLog("gather_repo", `Loaded ${files.length} JSON files from repository.`);
        sendStep("gather_repo", "done");

        sendStep("map_content", "running", "Mapping repository files to content payload");
        const mapping = mapRepoJsonFilesToEdgeEntries(files);
        for (const warning of mapping.warnings) {
          sendLog("map_content", warning);
        }
        if (mapping.entries.length === 0) {
          sendError("No valid page/config files found in repository", "ERR_REPO_SNAPSHOT_EMPTY", "map_content");
          controller.close();
          return;
        }
        sendLog(
          "map_content",
          `Mapped ${mapping.entries.length} entities (pages=${mapping.stats.mappedPages}, config=${mapping.stats.mappedConfig}).`
        );
        sendStep("map_content", "done");

        sendStep("write_store", "running", "Writing snapshot to Supabase store");
        const contentPayload: TenantContentPayload = { siteConfig: null, pages: {} };
        for (const entry of mapping.entries) {
          if (entry.type === "config") contentPayload.siteConfig = entry.data;
          if (entry.type === "page") contentPayload.pages[entry.slug] = entry.data;
        }
        await replaceTenantContent(tenant.id, contentPayload, { updatedBy: `snapshot:${auth.data.user.id}` });
        const namespace = tenantNamespaceFromId(tenant.id);
        sendLog("write_store", `Wrote ${mapping.entries.length} entities to namespace ${namespace}.`);
        sendStep("write_store", "done");

        sendStep("finalize", "running", "Finalizing tenant state");
        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
          .from("tenants")
          .update({
            updated_at: nowIso,
          })
          .eq("id", tenant.id);
        if (updateError) {
          sendError("Failed to update tenant metadata", "ERR_TENANT_UPDATE_FAILED", "finalize");
          controller.close();
          return;
        }
        sendStep("finalize", "done");

        metricSave("hotsave_snapshot_success", 1, {
          tenantId: tenant.id,
          entities: mapping.entries.length,
          pages: mapping.stats.mappedPages,
          config: mapping.stats.mappedConfig,
        });
        logSaveInfo("hotsave_snapshot.completed", {
          tenantId: tenant.id,
          correlationId,
          entities: mapping.entries.length,
          pages: mapping.stats.mappedPages,
          config: mapping.stats.mappedConfig,
          namespace: tenantNamespaceFromId(tenant.id),
        });

        send("done", {
          correlationId,
          tenantId: tenant.id,
          namespace: tenantNamespaceFromId(tenant.id),
          entitiesWritten: mapping.entries.length,
          pagesWritten: mapping.stats.mappedPages,
          configWritten: mapping.stats.mappedConfig,
          completedAt: nowIso,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "HotSave snapshot failed";
        metricSave("hotsave_snapshot_error", 1, { internal: true });
        logSaveError("hotsave_snapshot.failed", { correlationId, message });
        send("error", { message, code: "ERR_HOTSAVE_SNAPSHOT_INTERNAL", correlationId });
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
