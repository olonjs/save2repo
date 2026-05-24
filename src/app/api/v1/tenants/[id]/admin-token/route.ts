import { NextRequest, NextResponse } from "next/server";
import { createSign } from "crypto";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";

export const dynamic = "force-dynamic";

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildJwt(privateKeyPem: string): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(
    Buffer.from(JSON.stringify({ sub: "admin-access", iat: now, exp: now + 300 })),
  );
  const message = `${header}.${payload}`;
  const sign = createSign("SHA256");
  sign.update(message);
  const derSignature = sign.sign({ key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  const signature = base64urlEncode(derSignature);
  return `${message}.${signature}`;
}

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

  try {
    const supabase = getSupabaseAdmin();
    const { data: tenant, error } = await supabase
      .from("decrypted_tenants")
      .select("decrypted_admin_private_key, vercel_public_url, vercel_url")
      .eq("id", params.id)
      .single();

    if (error) throw new Error(error.message);
    if (!tenant?.decrypted_admin_private_key) {
      return NextResponse.json(
        { error: "Admin keypair not configured for this tenant.", code: "ERR_ADMIN_KEYPAIR_MISSING", correlationId },
        { status: 409 },
      );
    }

    const token = buildJwt(tenant.decrypted_admin_private_key);
    const baseUrl = tenant.vercel_public_url || tenant.vercel_url || "";
    const adminUrl = `${baseUrl}/admin`;

    return NextResponse.json({ correlationId, token, adminUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to issue admin token";
    return NextResponse.json({ error: message, code: "ERR_ADMIN_TOKEN_ISSUE_FAILED", correlationId }, { status: 500 });
  }
}
