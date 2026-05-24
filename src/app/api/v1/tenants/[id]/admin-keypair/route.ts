import { NextRequest, NextResponse } from "next/server";
import { generateKeyPairSync, createPublicKey } from "crypto";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";

export const dynamic = "force-dynamic";

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
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    // Verify the public key is well-formed before saving
    createPublicKey(publicKey);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("tenants")
      .update({ admin_private_key: privateKey })
      .eq("id", params.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ correlationId, publicKey }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate admin keypair";
    return NextResponse.json({ error: message, code: "ERR_ADMIN_KEYPAIR_GENERATE_FAILED", correlationId }, { status: 500 });
  }
}
