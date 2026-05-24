import { NextRequest, NextResponse } from "next/server";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { resolveCorrelationId } from "@/lib/correlation";
import { revokeTenantAgentCredential } from "@/lib/mcpGatewayCredentials";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; credentialId: string }> }
) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: "admin",
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.data.error, code: access.data.code, correlationId }, { status: access.data.status });
  }

  try {
    const revoked = await revokeTenantAgentCredential({
      tenantId: params.id,
      credentialId: params.credentialId,
    });
    if (!revoked) {
      return NextResponse.json(
        { error: "Credential not found or already revoked", code: "ERR_AGENT_CREDENTIAL_NOT_FOUND", correlationId },
        { status: 404 }
      );
    }

    return NextResponse.json({
      correlationId,
      tenantId: params.id,
      credentialId: revoked.id,
      revokedAt: revoked.revoked_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke agent credential";
    return NextResponse.json({ error: message, code: "ERR_AGENT_CREDENTIAL_REVOKE_FAILED", correlationId }, { status: 500 });
  }
}
