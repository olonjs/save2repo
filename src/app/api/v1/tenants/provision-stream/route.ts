import { NextRequest } from "next/server";
import { generateKeyPairSync, createPublicKey } from "crypto";
import { requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getInstallationOctokit,
  GithubInstallationTokenError,
} from "@/lib/githubAppClient";

// ----------------------------------------------------------------------------
// POST /api/v1/tenants/provision-stream (T-106)
//
// SSE-based tenant provisioning for the single-owner save2repo deployment.
//
// Authenticated via Supabase access-token bearer (the owner's session). Reads
// the owner's previously-seeded integration credentials from owner_integrations
// (T-A06 bootstrap) and orchestrates:
//
//   github-clone        Octokit POST /repos/{tmpl.owner}/{tmpl.repo}/generate
//                       — fork template into the buyer's GitHub as <slug>.
//                       Octokit auth is the buyer's olonjs installation token,
//                       minted on-demand via the olonjs token-signing endpoint
//                       (T-A02) by githubAppClient.getInstallationOctokit.
//   vercel-project      POST /v10/projects (with the buyer's Vercel OAuth
//                       token, scoped to their team) — gitRepository points at
//                       the freshly-created GitHub repo.
//   vercel-env          POST /v10/projects/{id}/env — VITE_JSONPAGES_CLOUD_URL
//                       points at THIS save2repo deployment so the tenant site
//                       knows where the CMS lives. VITE_JSONPAGES_API_KEY is
//                       deferred to T-110 (MCP credentials).
//   vercel-deploy       POST /v13/deployments to trigger the first deploy.
//   wait-ready          Poll the deployment until READY (or ERROR), bounded.
//   db                  INSERT into tenants (status='ready').
//
// SSE wire format:
//   data: {"type":"step","id":"vercel-project","label":"Creating Vercel project"}\n\n
//   data: {"type":"log","message":"..."}\n\n
//   data: {"type":"done","tenant":{"id":"...","slug":"...","name":"..."}}\n\n
//   data: {"type":"error","code":"ERR_GITHUB_CLONE_FAILED","message":"..."}\n\n
//
// Errors close the stream after emitting the error event — never throw out of
// the route handler once the response stream has started (would leave the
// client hanging).
// ----------------------------------------------------------------------------

export const dynamic = "force-dynamic";
// Edge runtime would be ideal for SSE latency but Octokit + node:crypto in
// githubAppClient pin us to Node. Vercel will keep this on Node fn runtime.

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const VERCEL_API = "https://api.vercel.com";
const DEPLOY_POLL_INTERVAL_MS = 4000;
const DEPLOY_POLL_TIMEOUT_MS = 5 * 60 * 1000;

type ProvisionBody = {
  template?: { owner?: unknown; repo?: unknown };
  slug?: unknown;
  name?: unknown;
};

type OwnerIntegrationsRow = {
  vercel_oauth_token: string | null;
  vercel_team_id: string | null;
  github_installation_id: number | null;
  github_account_login: string | null;
};

type EmitEvent =
  | { type: "step"; id: string; label: string }
  | { type: "log"; message: string }
  | { type: "done"; tenant: { id: string; slug: string; name: string } }
  | { type: "error"; code: string; message: string };

export async function POST(req: NextRequest) {
  // ----- 1. Auth (sync, before opening the SSE stream) ----------------------
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ error: auth.data.error, code: "ERR_AUTH" }),
      { status: auth.data.status, headers: { "Content-Type": "application/json" } },
    );
  }
  const userId = auth.data.user.id;

  // ----- 2. Body validation (sync) ------------------------------------------
  let body: ProvisionBody = {};
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body", code: "ERR_BAD_BODY" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const templateOwner = typeof body.template?.owner === "string" ? body.template.owner : "";
  const templateRepo = typeof body.template?.repo === "string" ? body.template.repo : "";
  const slug = typeof body.slug === "string" ? body.slug : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : slug;
  if (!templateOwner || !templateRepo) {
    return new Response(
      JSON.stringify({ error: "Missing template.owner/template.repo", code: "ERR_BAD_TEMPLATE" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!SLUG_REGEX.test(slug)) {
    return new Response(
      JSON.stringify({ error: "Invalid slug", code: "ERR_BAD_SLUG" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Cloud URL injected into the tenant so the deployed tenant knows the
  // address of THIS save2repo (for MCP / save flow). Falls back to the
  // request origin if not explicitly set.
  const cloudUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    new URL(req.url).origin;

  // Per-tenant public form key (T-114): random 32-hex secret embedded in the
  // tenant Vite app via VITE_FORM_KEY env, used to authenticate inbound POSTs
  // to /api/v1/forms/submit. Stored in tenants.public_form_key.
  const publicFormKey = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

  // ----- 3. Open SSE stream + run provisioning ------------------------------
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: EmitEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        await runProvisioning({
          userId,
          templateOwner,
          templateRepo,
          slug,
          name,
          cloudUrl,
          publicFormKey,
          emit,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown provisioning error";
        emit({ type: "error", code: "ERR_PROVISION_FAILED", message });
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

// ============================================================================
// Orchestration
// ============================================================================

async function runProvisioning(params: {
  userId: string;
  templateOwner: string;
  templateRepo: string;
  slug: string;
  name: string;
  cloudUrl: string;
  publicFormKey: string;
  emit: (event: EmitEvent) => void;
}): Promise<void> {
  const { userId, templateOwner, templateRepo, slug, name, cloudUrl, publicFormKey, emit } = params;
  const supabase = getSupabaseAdmin();

  // ----- Fetch owner_integrations -----
  emit({ type: "step", id: "auth", label: "Verifying integrations" });
  const { data: integ, error: integErr } = await supabase
    .from("owner_integrations")
    .select(
      "vercel_oauth_token, vercel_team_id, github_installation_id, github_account_login",
    )
    .eq("owner_user_id", userId)
    .maybeSingle<OwnerIntegrationsRow>();
  if (integErr) {
    emit({ type: "error", code: "ERR_INTEGRATIONS_LOOKUP", message: integErr.message });
    return;
  }
  if (!integ?.vercel_oauth_token || !integ.vercel_team_id) {
    emit({
      type: "error",
      code: "ERR_VERCEL_NOT_CONNECTED",
      message: "Vercel integration missing. Visit /settings/integrations.",
    });
    return;
  }
  if (!integ.github_installation_id) {
    emit({
      type: "error",
      code: "ERR_GITHUB_NOT_INSTALLED",
      message: "olonjs GitHub App not installed. Visit /settings/integrations.",
    });
    return;
  }
  const buyerGithubLogin = integ.github_account_login?.trim();
  if (!buyerGithubLogin) {
    emit({
      type: "error",
      code: "ERR_GITHUB_LOGIN_UNKNOWN",
      message: "Cannot resolve the buyer's GitHub login; reinstall the GitHub App.",
    });
    return;
  }

  // ----- GitHub: clone template via generate -----
  emit({
    type: "step",
    id: "github-clone",
    label: `Cloning ${templateOwner}/${templateRepo} → ${buyerGithubLogin}/${slug}`,
  });
  let githubRepoId: number;
  let githubRepoUrl: string;
  try {
    const octokit = await getInstallationOctokit(integ.github_installation_id);
    const res = await octokit.request(
      "POST /repos/{template_owner}/{template_repo}/generate",
      {
        template_owner: templateOwner,
        template_repo: templateRepo,
        owner: buyerGithubLogin,
        name: slug,
        description: name,
        private: false,
        include_all_branches: false,
      },
    );
    githubRepoId = res.data.id;
    githubRepoUrl = res.data.html_url;
    emit({ type: "log", message: `Repo created: ${githubRepoUrl}` });
  } catch (err) {
    if (err instanceof GithubInstallationTokenError) {
      emit({ type: "error", code: err.code, message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "GitHub clone failed";
    emit({ type: "error", code: "ERR_GITHUB_CLONE_FAILED", message });
    return;
  }

  // ----- Vercel: create project -----
  emit({ type: "step", id: "vercel-project", label: "Creating Vercel project" });
  const vercelHeaders = {
    Authorization: `Bearer ${integ.vercel_oauth_token}`,
    "Content-Type": "application/json",
  };
  const projectQuery = `?teamId=${encodeURIComponent(integ.vercel_team_id)}`;
  let vercelProjectId: string;
  try {
    const res = await fetch(`${VERCEL_API}/v10/projects${projectQuery}`, {
      method: "POST",
      headers: vercelHeaders,
      body: JSON.stringify({
        name: slug,
        gitRepository: {
          type: "github",
          repo: `${buyerGithubLogin}/${slug}`,
        },
        framework: "vite",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vercel create-project ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id: string };
    vercelProjectId = data.id;
    emit({ type: "log", message: `Vercel project id: ${vercelProjectId}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vercel project create failed";
    emit({ type: "error", code: "ERR_VERCEL_PROJECT_FAILED", message });
    return;
  }

  // ----- Admin keypair bootstrap (ADR-002, parent parity) -----
  // Generate EC P-256 keypair so the Admin button in Overview works from
  // first boot — no manual "Generate Keypair" step in Settings. Failure
  // here is non-fatal: provision continues, owner can generate later via
  // POST /api/v1/tenants/[id]/admin-keypair.
  let adminPrivateKey: string | null = null;
  let adminPublicKey: string | null = null;
  try {
    const pair = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    createPublicKey(pair.publicKey);
    adminPrivateKey = pair.privateKey;
    adminPublicKey = pair.publicKey;
    emit({ type: "log", message: "Admin keypair generated (EC P-256)" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    emit({
      type: "log",
      message: `WARN: admin keypair generation skipped (${message}); configurable from Settings later.`,
    });
  }

  // ----- Vercel: set env vars -----
  emit({ type: "step", id: "vercel-env", label: "Injecting tenant env" });
  try {
    const envRes = await fetch(
      `${VERCEL_API}/v10/projects/${vercelProjectId}/env${projectQuery}`,
      {
        method: "POST",
        headers: vercelHeaders,
        body: JSON.stringify([
          {
            key: "VITE_JSONPAGES_CLOUD_URL",
            value: cloudUrl,
            type: "plain",
            target: ["production", "preview", "development"],
          },
          {
            // T-114: per-tenant public form key embedded in the Vite app
            // so the tenant site can POST /api/v1/forms/submit with the
            // bearer + receive leads in the owner's Leads tab.
            key: "VITE_FORM_KEY",
            value: publicFormKey,
            type: "encrypted",
            target: ["production", "preview", "development"],
          },
          // ADR-002 + parent parity: ADMIN_PUBLIC_KEY at provision time so the
          // Admin button in Overview works first boot, no Settings step.
          ...(adminPublicKey
            ? [
                {
                  key: "ADMIN_PUBLIC_KEY",
                  value: adminPublicKey,
                  type: "encrypted" as const,
                  target: ["production", "preview", "development"] as const,
                },
              ]
            : []),
          // VITE_JSONPAGES_API_KEY is deferred to T-110 once MCP credentials
          // are assigned for this tenant.
        ]),
      },
    );
    if (!envRes.ok) {
      const text = await envRes.text().catch(() => "");
      throw new Error(`Vercel env ${envRes.status}: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vercel env injection failed";
    emit({ type: "error", code: "ERR_VERCEL_ENV_FAILED", message });
    return;
  }

  // ----- Vercel: trigger first deploy -----
  emit({ type: "step", id: "vercel-deploy", label: "Triggering first deploy" });
  let deploymentId: string;
  try {
    const res = await fetch(`${VERCEL_API}/v13/deployments${projectQuery}`, {
      method: "POST",
      headers: vercelHeaders,
      body: JSON.stringify({
        name: slug,
        project: vercelProjectId,
        gitSource: {
          type: "github",
          repoId: githubRepoId,
          ref: "main",
        },
        target: "production",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vercel deploy ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id: string; url?: string };
    deploymentId = data.id;
    emit({ type: "log", message: `Deployment queued: ${deploymentId}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vercel deploy trigger failed";
    emit({ type: "error", code: "ERR_VERCEL_DEPLOY_FAILED", message });
    return;
  }

  // ----- Wait for READY -----
  emit({ type: "step", id: "wait-ready", label: "Waiting for deploy READY" });
  let deployUrl: string | null = null;
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < DEPLOY_POLL_TIMEOUT_MS) {
      const res = await fetch(
        `${VERCEL_API}/v13/deployments/${deploymentId}${projectQuery}`,
        { headers: { Authorization: `Bearer ${integ.vercel_oauth_token}` } },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Vercel poll ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        readyState?: string;
        state?: string;
        url?: string;
        alias?: string[];
      };
      const state = (data.readyState ?? data.state ?? "").toUpperCase();
      if (state === "READY") {
        deployUrl = data.alias?.[0] ? `https://${data.alias[0]}` : data.url ? `https://${data.url}` : null;
        emit({ type: "log", message: `Deploy READY: ${deployUrl ?? "(no url)"}` });
        break;
      }
      if (state === "ERROR" || state === "CANCELED") {
        emit({
          type: "error",
          code: "ERR_VERCEL_DEPLOY_STATE",
          message: `Deployment ended in state ${state}`,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, DEPLOY_POLL_INTERVAL_MS));
    }
    if (!deployUrl) {
      emit({
        type: "error",
        code: "ERR_VERCEL_DEPLOY_TIMEOUT",
        message: `Deployment did not reach READY in ${DEPLOY_POLL_TIMEOUT_MS / 1000}s`,
      });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wait-ready failed";
    emit({ type: "error", code: "ERR_VERCEL_POLL_FAILED", message });
    return;
  }

  // ----- INSERT tenants row -----
  emit({ type: "step", id: "db", label: "Saving tenant" });
  let tenantId: string;
  try {
    const { data, error } = await supabase
      .from("tenants")
      .insert({
        owner_user_id: userId,
        slug,
        status: "ready",
        deployment_target: "client_vercel",
        github_owner_login: buyerGithubLogin,
        github_repo_name: slug,
        github_repo_id: githubRepoId,
        vercel_project_id: vercelProjectId,
        vercel_url: deployUrl,
        vercel_public_url: `https://${slug}.vercel.app`,
        public_form_key: publicFormKey,
        admin_private_key: adminPrivateKey,
        admin_public_key: adminPublicKey,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data?.id) {
      throw new Error(error?.message ?? "tenants insert returned no id");
    }
    tenantId = data.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tenant insert failed";
    emit({ type: "error", code: "ERR_DB_INSERT_FAILED", message });
    return;
  }

  emit({ type: "done", tenant: { id: tenantId, slug, name } });
}
