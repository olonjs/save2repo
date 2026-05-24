import { NextRequest } from "next/server";
import { requireRequestUser, assertOwner } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  writeContent,
  ContentApiError,
} from "@/lib/githubContent";
import { GithubInstallationTokenError } from "@/lib/githubAppClient";

// ----------------------------------------------------------------------------
// POST /api/v1/tenants/[id]/save-stream (T-108)
//
// SSE-visualized save flow for the single-owner save2repo model (ADR-005:
// save = commit). Replaces the parent saveRepoCommitDeploy.ts which used the
// direct GitHub App private key + parent column names (github_repo_owner)
// that don't exist in save2repo (github_owner_login + githubAppClient pattern
// per T-104 / ADR-006).
//
// Flow:
//   step  commit    → githubContent.writeContent (PUT /repos/.../contents/{path})
//   step  rebuild   → poll Vercel /v6/deployments?projectId=...&teamId=... for
//                     a deployment created AFTER the commit timestamp
//   step  live      → poll the found deployment's readyState until READY/ERROR
//   done             { liveUrl, sha }
//
// Body: { path: string, content: string, sha?: string, message?: string }
// Auth: Supabase access-token bearer; owner check via assertOwner.
//
// Times: each step has a sane bound (rebuild discovery: 60s, ready wait: 5min).
// Errors close the stream after emitting an error event.
// ----------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const VERCEL_API = "https://api.vercel.com";
const REBUILD_DISCOVERY_TIMEOUT_MS = 60 * 1000;
const READY_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

type SaveBody = {
  path?: unknown;
  content?: unknown;
  sha?: unknown;
  message?: unknown;
};

type TenantSaveRow = {
  id: string;
  owner_user_id: string;
  github_owner_login: string | null;
  github_repo_name: string | null;
  vercel_project_id: string | null;
};

type OwnerIntegrationsRow = {
  vercel_oauth_token: string | null;
  vercel_team_id: string | null;
  github_installation_id: number | null;
};

type VercelDeployment = {
  uid?: string;
  id?: string;
  state?: string;
  readyState?: string;
  createdAt?: number;
  url?: string;
  alias?: string[];
};

type SaveEvent =
  | { type: "step"; id: string; label: string }
  | { type: "log"; message: string }
  | { type: "done"; sha: string; liveUrl: string | null }
  | { type: "error"; code: string; message: string };

function isSafePath(path: string): boolean {
  if (!path || path.length > 1000) return false;
  if (path.startsWith("/") || path.includes("\0")) return false;
  return !path.split("/").some((s) => s === "" || s === "." || s === "..");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Sync auth + validation before opening stream.
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return jsonError(auth.data.status, auth.data.error, "ERR_AUTH");
  }
  const { id: tenantId } = await params;
  const ownerCheck = await assertOwner({ userId: auth.data.user.id, tenantId });
  if (!ownerCheck.ok) {
    return jsonError(ownerCheck.data.status, ownerCheck.data.error, ownerCheck.data.code);
  }

  let body: SaveBody = {};
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return jsonError(400, "Invalid JSON body", "ERR_BAD_BODY");
  }
  const path = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : null;
  const sha = typeof body.sha === "string" ? body.sha : undefined;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : `Update ${path} via save2repo`;
  if (!isSafePath(path)) return jsonError(400, "Invalid path", "ERR_BAD_PATH");
  if (content === null) return jsonError(400, "Missing body.content", "ERR_MISSING_CONTENT");

  const supabase = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, owner_user_id, github_owner_login, github_repo_name, vercel_project_id")
    .eq("id", tenantId)
    .maybeSingle<TenantSaveRow>();
  if (tenantErr) return jsonError(500, tenantErr.message, "ERR_TENANT_LOOKUP");
  if (!tenant?.github_owner_login || !tenant.github_repo_name || !tenant.vercel_project_id) {
    return jsonError(409, "Tenant provisioning incomplete", "ERR_TENANT_INCOMPLETE");
  }

  const { data: integ, error: integErr } = await supabase
    .from("owner_integrations")
    .select("vercel_oauth_token, vercel_team_id, github_installation_id")
    .eq("owner_user_id", auth.data.user.id)
    .maybeSingle<OwnerIntegrationsRow>();
  if (integErr) return jsonError(500, integErr.message, "ERR_INTEGRATIONS_LOOKUP");
  if (!integ?.vercel_oauth_token || !integ.vercel_team_id || !integ.github_installation_id) {
    return jsonError(409, "Owner integrations missing", "ERR_INTEGRATIONS_INCOMPLETE");
  }

  // Open SSE stream.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: SaveEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        await runSave({
          tenant: tenant!,
          integ: integ!,
          path,
          content,
          sha,
          message,
          emit,
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : "Unknown save error";
        emit({ type: "error", code: "ERR_SAVE_FAILED", message: m });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runSave(params: {
  tenant: TenantSaveRow;
  integ: OwnerIntegrationsRow;
  path: string;
  content: string;
  sha?: string;
  message: string;
  emit: (event: SaveEvent) => void;
}): Promise<void> {
  const { tenant, integ, path, content, sha, message, emit } = params;
  const owner = tenant.github_owner_login!;
  const repo = tenant.github_repo_name!;
  const projectId = tenant.vercel_project_id!;
  const teamId = integ.vercel_team_id!;
  const installationId = integ.github_installation_id!;
  const vercelToken = integ.vercel_oauth_token!;

  // ----- 1. Commit -----
  emit({ type: "step", id: "commit", label: `Committing ${path}` });
  const commitStartedAt = Date.now();
  let newSha: string;
  try {
    const res = await writeContent(installationId, owner, repo, path, {
      content,
      message,
      sha,
    });
    newSha = res.sha;
    emit({ type: "log", message: `Commit sha=${newSha.slice(0, 7)}` });
  } catch (err) {
    if (err instanceof GithubInstallationTokenError) {
      emit({ type: "error", code: err.code, message: err.message });
      return;
    }
    if (err instanceof ContentApiError) {
      emit({ type: "error", code: err.code, message: err.message });
      return;
    }
    const m = err instanceof Error ? err.message : "Commit failed";
    emit({ type: "error", code: "ERR_COMMIT_FAILED", message: m });
    return;
  }

  // ----- 2. Discover the rebuild deployment -----
  emit({ type: "step", id: "rebuild", label: "Waiting for Vercel rebuild" });
  const vercelHeaders = { Authorization: `Bearer ${vercelToken}` };
  const projectQuery = `?teamId=${encodeURIComponent(teamId)}`;
  let deploymentId: string | null = null;
  const discoveryDeadline = commitStartedAt + REBUILD_DISCOVERY_TIMEOUT_MS;
  while (Date.now() < discoveryDeadline && !deploymentId) {
    try {
      const res = await fetch(
        `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&teamId=${encodeURIComponent(teamId)}&limit=10`,
        { headers: vercelHeaders },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Vercel list ${res.status}: ${t.slice(0, 200)}`);
      }
      const data = (await res.json()) as { deployments?: VercelDeployment[] };
      const fresh = (data.deployments ?? []).find(
        (d) => typeof d.createdAt === "number" && d.createdAt >= commitStartedAt - 5000,
      );
      if (fresh?.uid || fresh?.id) {
        deploymentId = (fresh.uid ?? fresh.id)!;
        emit({ type: "log", message: `Rebuild deployment: ${deploymentId}` });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "Deployment discovery failed";
      emit({ type: "error", code: "ERR_DEPLOY_DISCOVERY_FAILED", message: m });
      return;
    }
    if (!deploymentId) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  if (!deploymentId) {
    emit({
      type: "error",
      code: "ERR_DEPLOY_NOT_FOUND",
      message: `No new deployment found within ${REBUILD_DISCOVERY_TIMEOUT_MS / 1000}s (Vercel git integration may be disconnected)`,
    });
    return;
  }

  // ----- 3. Wait for READY -----
  emit({ type: "step", id: "live", label: "Waiting for deploy READY" });
  let liveUrl: string | null = null;
  const readyDeadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < readyDeadline) {
    try {
      const res = await fetch(
        `${VERCEL_API}/v13/deployments/${deploymentId}${projectQuery}`,
        { headers: vercelHeaders },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Vercel get ${res.status}: ${t.slice(0, 200)}`);
      }
      const d = (await res.json()) as VercelDeployment;
      const state = (d.readyState ?? d.state ?? "").toUpperCase();
      emit({ type: "log", message: `State: ${state}` });
      if (state === "READY") {
        liveUrl = d.alias?.[0]
          ? `https://${d.alias[0]}`
          : d.url
          ? `https://${d.url}`
          : null;
        break;
      }
      if (state === "ERROR" || state === "CANCELED") {
        emit({ type: "error", code: "ERR_DEPLOY_STATE", message: `Deploy ended in ${state}` });
        return;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "Poll failed";
      emit({ type: "error", code: "ERR_DEPLOY_POLL_FAILED", message: m });
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!liveUrl) {
    emit({
      type: "error",
      code: "ERR_DEPLOY_TIMEOUT",
      message: `Deployment did not reach READY within ${READY_TIMEOUT_MS / 1000}s`,
    });
    return;
  }

  emit({ type: "done", sha: newSha, liveUrl });
}

function jsonError(status: number, error: string, code: string) {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
