import { NextRequest, NextResponse } from "next/server";
import { generateKeyPairSync, createPublicKey } from "crypto";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/correlation";

export const dynamic = "force-dynamic";

const VERCEL_API = "https://api.vercel.com";

// ----------------------------------------------------------------------------
// POST /api/v1/tenants/[id]/admin-keypair
//
// Generate (or rotate) the tenant's admin keypair (ADR-002). EC P-256 keys
// are PEM-encoded:
//   - private (pkcs8) → tenants.admin_private_key (pgsodium-encrypted)
//   - public  (spki)  → tenants.admin_public_key + Vercel env ADMIN_PUBLIC_KEY
//                       on the tenant project so the deployed Vite app can
//                       verify JWTs signed by the admin private key
//
// Returns the public PEM so the UI can render it for copy/audit. The private
// PEM is never returned (only stored encrypted).
// ----------------------------------------------------------------------------

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const access = await assertTenantAccess({ userId: auth.data.user.id, tenantId: params.id, requiredRole: "admin" });
  if (!access.ok) {
    return NextResponse.json({ error: access.data.error, code: access.data.code, correlationId }, { status: access.data.status });
  }

  const supabase = getSupabaseAdmin();

  // Lookup tenant + owner_integrations for Vercel API auth.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, owner_user_id, vercel_project_id")
    .eq("id", params.id)
    .maybeSingle<{ id: string; owner_user_id: string; vercel_project_id: string | null }>();
  if (tenantErr || !tenant) {
    return NextResponse.json(
      { error: tenantErr?.message ?? "Tenant not found", code: "ERR_TENANT_LOOKUP", correlationId },
      { status: 500 },
    );
  }

  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    createPublicKey(publicKey); // sanity check

    const { error: updErr } = await supabase
      .from("tenants")
      .update({ admin_private_key: privateKey, admin_public_key: publicKey })
      .eq("id", params.id);
    if (updErr) throw new Error(updErr.message);

    // Best-effort push of ADMIN_PUBLIC_KEY to the tenant's Vercel project env.
    // Failure here does NOT roll back the DB rotation — the UI surfaces the
    // public key for manual copy as a fallback.
    let vercelPushStatus: "skipped" | "pushed" | "failed" = "skipped";
    let vercelPushError: string | null = null;
    if (tenant.vercel_project_id) {
      const { data: integ } = await supabase
        .from("owner_integrations")
        .select("vercel_oauth_token, vercel_team_id")
        .eq("owner_user_id", tenant.owner_user_id)
        .maybeSingle<{ vercel_oauth_token: string | null; vercel_team_id: string | null }>();
      if (integ?.vercel_oauth_token && integ.vercel_team_id) {
        try {
          await pushVercelEnv({
            token: integ.vercel_oauth_token,
            teamId: integ.vercel_team_id,
            projectId: tenant.vercel_project_id,
            key: "ADMIN_PUBLIC_KEY",
            value: publicKey,
          });
          vercelPushStatus = "pushed";
        } catch (err) {
          vercelPushStatus = "failed";
          vercelPushError = err instanceof Error ? err.message : "unknown";
        }
      }
    }

    return NextResponse.json(
      { correlationId, publicKey, vercelPushStatus, vercelPushError },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate admin keypair";
    return NextResponse.json({ error: message, code: "ERR_ADMIN_KEYPAIR_GENERATE_FAILED", correlationId }, { status: 500 });
  }
}

async function pushVercelEnv(params: {
  token: string;
  teamId: string;
  projectId: string;
  key: string;
  value: string;
}): Promise<void> {
  const { token, teamId, projectId, key, value } = params;
  const baseUrl = `${VERCEL_API}/v10/projects/${projectId}/env?teamId=${encodeURIComponent(teamId)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // List existing envs to find any pre-existing entry to remove (Vercel POST
  // /env fails 409 on duplicate key+target collision).
  const listRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env?teamId=${encodeURIComponent(teamId)}`, {
    headers,
  });
  if (listRes.ok) {
    const listJson = (await listRes.json()) as { envs?: Array<{ id: string; key: string }> };
    const existing = (listJson.envs ?? []).filter((e) => e.key === key);
    for (const env of existing) {
      await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${env.id}?teamId=${encodeURIComponent(teamId)}`, {
        method: "DELETE",
        headers,
      });
    }
  }

  const createRes = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify([
      {
        key,
        value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      },
    ]),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`Vercel env push ${createRes.status}: ${body.slice(0, 200)}`);
  }
}
