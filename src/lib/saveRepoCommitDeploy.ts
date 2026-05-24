import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "octokit";
import { logSaveInfo, metricSave } from "@/lib/saveTelemetry";

export type RepoFileForCommit = { path: string; content: unknown };

export type TenantForRepoDeploy = {
  id: string;
  github_installation_id: string;
  github_repo_owner: string;
  github_repo_name: string;
  vercel_project_id: string;
  unsynced_changes_count?: number | null;
};

type VercelDeployment = {
  id?: string;
  state?: string;
  readyState?: string;
  createdAt?: number;
  url?: string;
  alias?: string[];
};

type VercelProjectResponse = {
  id?: string;
  name?: string;
  link?: { repoId?: string | number };
  error?: { message?: string };
};

type StepId = "commit" | "build" | "live";

function toPublicUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function toCanonicalLiveUrl(deployment: VercelDeployment, projectName?: string): string | null {
  const alias = Array.isArray(deployment.alias) && typeof deployment.alias[0] === "string" ? deployment.alias[0] : null;
  const aliasUrl = toPublicUrl(alias);
  if (aliasUrl) return aliasUrl;
  if (typeof projectName === "string" && projectName.trim()) {
    return `https://${projectName}.vercel.app`;
  }
  const directUrl = typeof deployment.url === "string" ? deployment.url : null;
  return toPublicUrl(directUrl);
}

function getEffectiveDeploymentState(deployment: VercelDeployment): string {
  const rawState = deployment.readyState ?? deployment.state ?? "QUEUED";
  return rawState.toUpperCase();
}

function getDeploymentStateTrace(deployment: VercelDeployment): string {
  return `readyState=${deployment.readyState ?? "-"}, state=${deployment.state ?? "-"} => effective=${getEffectiveDeploymentState(
    deployment
  )}`;
}

async function waitForDeploymentById(
  deploymentId: string,
  teamId: string,
  token: string,
  sendLog: (msg: string) => void
): Promise<VercelDeployment | null> {
  const maxAttempts = 90;
  const intervalMs = 5000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const getRes = await fetch(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const deployment = (await getRes.json().catch(() => ({}))) as VercelDeployment & { error?: { message?: string } };
    if (!getRes.ok) {
      const msg = deployment.error?.message ?? `Vercel deployment fetch failed: ${getRes.status}`;
      throw new Error(msg);
    }
    const state = getEffectiveDeploymentState(deployment);
    sendLog(`Deployment status: ${getDeploymentStateTrace(deployment)}`);
    if (state === "READY") return deployment;
    if (state === "ERROR" || state === "CANCELED" || state === "FAILED") return deployment;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export type CommitBuildDeployTelemetry = {
  operation: "save2repo" | "cold_save";
  correlationId: string;
};

export type CommitBuildDeployResult =
  | { ok: true; deployUrl: string; commitSha: string; syncedAt: string; filesCount: number }
  | { ok: false; message: string; code: string; stepId?: StepId };

/**
 * Commits JSON files to the tenant GitHub repo, triggers production Vercel deploy,
 * updates tenant sync fields, upserts deployments row, best-effort preview refresh.
 */
export async function executeCommitBuildDeploy(params: {
  files: RepoFileForCommit[];
  tenant: TenantForRepoDeploy;
  commitMessage: string;
  correlationId: string;
  supabaseAdmin: SupabaseClient;
  sendLog: (stepId: StepId, message: string) => void;
  sendStep?: (id: StepId, status: "running" | "done", label?: string) => void;
  telemetry: CommitBuildDeployTelemetry;
}): Promise<CommitBuildDeployResult> {
  const { files, tenant, commitMessage, correlationId, supabaseAdmin, sendLog, sendStep, telemetry } = params;
  const step = (id: StepId, status: "running" | "done", label?: string) => {
    sendStep?.(id, status, label);
  };
  const vercelTeamId = process.env.VERCEL_TEAM_ID;
  const vercelToken = process.env.VERCEL_AUTH_TOKEN;
  if (!vercelTeamId || !vercelToken) {
    return { ok: false, message: "Vercel not configured", code: "ERR_VERCEL_NOT_CONFIGURED", stepId: "build" };
  }

  try {
    step("commit", "running", "Syncing to repository");
    sendLog("commit", "Syncing to repository");
    const app = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    });
    const octokit = await app.getInstallationOctokit(Number(tenant.github_installation_id));

    let lastCommitSha: string | null = null;
    for (const file of files) {
      let existingSha: string | undefined;
      try {
        const current = await octokit.rest.repos.getContent({
          owner: tenant.github_repo_owner,
          repo: tenant.github_repo_name,
          path: file.path,
        });
        if (!Array.isArray(current.data)) {
          existingSha = current.data.sha;
        }
      } catch {
        existingSha = undefined;
      }

      const commitResponse = await octokit.rest.repos.createOrUpdateFileContents({
        owner: tenant.github_repo_owner,
        repo: tenant.github_repo_name,
        path: file.path,
        message: commitMessage,
        content: Buffer.from(JSON.stringify(file.content, null, 2)).toString("base64"),
        sha: existingSha,
      });
      lastCommitSha = commitResponse.data.commit?.sha ?? lastCommitSha;
    }
    if (!lastCommitSha) {
      return { ok: false, message: "GitHub commit SHA missing", code: "ERR_GITHUB_COMMIT_SHA_MISSING", stepId: "commit" };
    }
    sendLog("commit", `Committed ${files.length} files to GitHub (${lastCommitSha.slice(0, 7)}).`);
    step("commit", "done");

    step("build", "running", "Waiting Vercel build");
    sendLog("build", "Resolving linked Vercel repository...");
    const projectRes = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(tenant.vercel_project_id)}?teamId=${encodeURIComponent(vercelTeamId)}`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    );
    const projectData = (await projectRes.json().catch(() => ({}))) as VercelProjectResponse;
    if (!projectRes.ok) {
      return {
        ok: false,
        message: projectData.error?.message ?? `Failed to fetch Vercel project (${projectRes.status}).`,
        code: "ERR_VERCEL_PROJECT_FETCH_FAILED",
        stepId: "build",
      };
    }
    const repoIdRaw = projectData.link?.repoId;
    const repoId = typeof repoIdRaw === "string" || typeof repoIdRaw === "number" ? Number(repoIdRaw) : NaN;
    if (!Number.isFinite(repoId)) {
      return {
        ok: false,
        message: "Vercel project is not linked to a Git repository",
        code: "ERR_VERCEL_REPO_LINK_MISSING",
        stepId: "build",
      };
    }

    sendLog("build", "Triggering deploy for synced commit...");
    const deployBody: Record<string, unknown> = {
      project: tenant.vercel_project_id,
      gitSource: { type: "github", ref: "main", repoId },
      target: "production",
    };
    if (typeof projectData.name === "string" && projectData.name.trim()) {
      deployBody.name = projectData.name;
    }
    const triggerRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(vercelTeamId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployBody),
    });
    const triggerData = (await triggerRes.json().catch(() => ({}))) as VercelDeployment & { error?: { message?: string } };
    if (!triggerRes.ok || !triggerData.id) {
      return {
        ok: false,
        message: triggerData.error?.message ?? `Failed to trigger deploy (${triggerRes.status}).`,
        code: "ERR_VERCEL_DEPLOY_TRIGGER_FAILED",
        stepId: "build",
      };
    }

    const deployment = await waitForDeploymentById(triggerData.id, vercelTeamId, vercelToken, (message) =>
      sendLog("build", message)
    );
    if (!deployment) {
      return { ok: false, message: "Timed out while waiting for Vercel deployment.", code: "ERR_VERCEL_DEPLOY_TIMEOUT", stepId: "build" };
    }
    const state = getEffectiveDeploymentState(deployment);
    if (state === "ERROR" || state === "CANCELED" || state === "FAILED") {
      return { ok: false, message: `Vercel deployment failed (${state}).`, code: "ERR_VERCEL_DEPLOY_FAILED", stepId: "build" };
    }
    if (state !== "READY") {
      return {
        ok: false,
        message: `Vercel deployment did not reach READY (state=${state}).`,
        code: "ERR_VERCEL_DEPLOY_FAILED",
        stepId: "build",
      };
    }

    step("build", "done");
    step("live", "running", "Publishing");
    sendLog("live", "Publishing");
    const deployUrl = toCanonicalLiveUrl(deployment, projectData.name);
    if (!deployUrl) {
      return { ok: false, message: "Deployment READY but URL missing", code: "ERR_VERCEL_DEPLOY_URL_MISSING", stepId: "live" };
    }

    const nowIso = new Date().toISOString();
    const tenantUpdatePayload: Record<string, unknown> = {
      vercel_url: deployUrl,
      unsynced_changes_count: 0,
      sync_status: "synced",
      last_cold_sync_at: nowIso,
      updated_at: nowIso,
    };
    const { error: tenantUpdateError } = await supabaseAdmin
      .from("tenants")
      .update(tenantUpdatePayload)
      .eq("id", tenant.id);
    if (tenantUpdateError) {
      return {
        ok: false,
        message: "Failed to persist tenant sync state",
        code: "ERR_TENANT_SYNC_STATE_PERSIST_FAILED",
        stepId: "live",
      };
    }

    await supabaseAdmin.from("deployments").upsert(
      {
        tenant_id: tenant.id,
        commit_sha: lastCommitSha,
        status: "ready",
        url: deployUrl,
        updated_at: nowIso,
      },
      { onConflict: "commit_sha" }
    );

    // save2repo: tenant preview screenshot refresh is out-of-scope at day-1.

    const successMetric = telemetry.operation === "cold_save" ? "cold_save_success" : "save2repo_success";
    metricSave(successMetric, 1, {
      tenantId: tenant.id,
      files: files.length,
      hadDirty: (tenant.unsynced_changes_count ?? 0) > 0,
    });
    const completedLogKey = telemetry.operation === "cold_save" ? "cold_save.completed" : "save2repo.completed";
    logSaveInfo(completedLogKey, {
      tenantId: tenant.id,
      correlationId,
      deployUrl,
      files: files.length,
      commitSha: lastCommitSha,
    });

    step("live", "done");
    return { ok: true, deployUrl, commitSha: lastCommitSha, syncedAt: nowIso, filesCount: files.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errMetric = telemetry.operation === "cold_save" ? "cold_save_error" : "save2repo_error";
    const errLogKey = telemetry.operation === "cold_save" ? "cold_save.failed" : "save2repo.failed";
    metricSave(errMetric, 1, { internal: true });
    // logSaveError is referenced by ADR-005 path but removed with preview-refresh import;
    // re-import locally for the catch path only.
    const { logSaveError } = await import("@/lib/saveTelemetry");
    logSaveError(errLogKey, { message, tenantId: tenant.id, correlationId });
    return { ok: false, message, code: "ERR_REPO_DEPLOY_PIPELINE_INTERNAL", stepId: "commit" };
  }
}
