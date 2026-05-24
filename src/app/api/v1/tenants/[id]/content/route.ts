import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, assertOwner } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  readContent,
  writeContent,
  ContentNotFoundError,
  ContentApiError,
} from "@/lib/githubContent";
import { GithubInstallationTokenError } from "@/lib/githubAppClient";

// ----------------------------------------------------------------------------
// /api/v1/tenants/[id]/content?path=<path> (T-107)
//
// Single-owner content read/write for a tenant, backed by the buyer's GitHub
// repository (ADR-005: no central content store). Both GET and PUT go through
// githubContent helpers which hit the GitHub Contents API via an installation
// token minted on-demand by the olonjs token-signing endpoint.
//
//   GET  → 200 { path, content, sha } | 404 ERR_CONTENT_NOT_FOUND
//   PUT  → body { content: string, sha?: string, message?: string }
//          200 { path, sha }
//
// Auth: Supabase access-token bearer (owner check via assertOwner).
//
// `path` is validated against a defensive whitelist (no leading slash, no
// '..' segments, no null bytes) to prevent path traversal against the repo
// contents API.
// ----------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type TenantContentRow = {
  id: string;
  owner_user_id: string;
  github_owner_login: string | null;
  github_repo_name: string | null;
};

type OwnerIntegrationsRow = {
  github_installation_id: number | null;
};

function isSafePath(path: string): boolean {
  if (!path) return false;
  if (path.length > 1000) return false;
  if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) return false;
  if (path.includes("\0")) return false;
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return false;
  }
  return true;
}

async function resolveTenantContext(params: {
  userId: string;
  tenantId: string;
}): Promise<
  | { ok: true; data: { owner: string; repo: string; installationId: number } }
  | { ok: false; status: number; error: string; code: string }
> {
  const ownerCheck = await assertOwner(params);
  if (!ownerCheck.ok) {
    return {
      ok: false,
      status: ownerCheck.data.status,
      error: ownerCheck.data.error,
      code: ownerCheck.data.code,
    };
  }
  const supabase = getSupabaseAdmin();

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, owner_user_id, github_owner_login, github_repo_name")
    .eq("id", params.tenantId)
    .maybeSingle<TenantContentRow>();
  if (tenantErr) {
    return {
      ok: false,
      status: 500,
      error: tenantErr.message,
      code: "ERR_TENANT_LOOKUP_FAILED",
    };
  }
  if (!tenant?.github_owner_login || !tenant.github_repo_name) {
    return {
      ok: false,
      status: 409,
      error: "Tenant has no associated GitHub repo (provisioning incomplete)",
      code: "ERR_TENANT_NO_REPO",
    };
  }

  const { data: integ, error: integErr } = await supabase
    .from("owner_integrations")
    .select("github_installation_id")
    .eq("owner_user_id", params.userId)
    .maybeSingle<OwnerIntegrationsRow>();
  if (integErr) {
    return {
      ok: false,
      status: 500,
      error: integErr.message,
      code: "ERR_INTEGRATIONS_LOOKUP_FAILED",
    };
  }
  if (!integ?.github_installation_id) {
    return {
      ok: false,
      status: 409,
      error: "GitHub App installation_id missing on owner_integrations",
      code: "ERR_GITHUB_NOT_INSTALLED",
    };
  }

  return {
    ok: true,
    data: {
      owner: tenant.github_owner_login,
      repo: tenant.github_repo_name,
      installationId: integ.github_installation_id,
    },
  };
}

function bearerError(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status });
}

function mapGithubError(err: unknown) {
  if (err instanceof ContentNotFoundError) {
    return bearerError(404, err.message, "ERR_CONTENT_NOT_FOUND");
  }
  if (err instanceof GithubInstallationTokenError) {
    return bearerError(err.status, err.message, err.code);
  }
  if (err instanceof ContentApiError) {
    return bearerError(err.status, err.message, err.code);
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return bearerError(500, message, "ERR_UNKNOWN");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(req);
  if (!auth.ok) return bearerError(auth.data.status, auth.data.error, "ERR_AUTH");
  const { id: tenantId } = await params;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!isSafePath(path)) return bearerError(400, "Invalid path", "ERR_BAD_PATH");

  const ctx = await resolveTenantContext({ userId: auth.data.user.id, tenantId });
  if (!ctx.ok) return bearerError(ctx.status, ctx.error, ctx.code);

  try {
    const result = await readContent(ctx.data.installationId, ctx.data.owner, ctx.data.repo, path);
    return NextResponse.json({
      path,
      content: result.content,
      sha: result.sha,
    });
  } catch (err) {
    return mapGithubError(err);
  }
}

type PutBody = {
  content?: unknown;
  sha?: unknown;
  message?: unknown;
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(req);
  if (!auth.ok) return bearerError(auth.data.status, auth.data.error, "ERR_AUTH");
  const { id: tenantId } = await params;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!isSafePath(path)) return bearerError(400, "Invalid path", "ERR_BAD_PATH");

  let body: PutBody = {};
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return bearerError(400, "Invalid JSON body", "ERR_BAD_BODY");
  }
  const content = typeof body.content === "string" ? body.content : null;
  const sha = typeof body.sha === "string" ? body.sha : undefined;
  const message = typeof body.message === "string" && body.message.trim()
    ? body.message.trim()
    : `Update ${path} via save2repo`;
  if (content === null) {
    return bearerError(400, "Missing body.content (string)", "ERR_MISSING_CONTENT");
  }

  const ctx = await resolveTenantContext({ userId: auth.data.user.id, tenantId });
  if (!ctx.ok) return bearerError(ctx.status, ctx.error, ctx.code);

  try {
    const result = await writeContent(
      ctx.data.installationId,
      ctx.data.owner,
      ctx.data.repo,
      path,
      { content, message, sha },
    );
    return NextResponse.json({ path, sha: result.sha });
  } catch (err) {
    return mapGithubError(err);
  }
}
