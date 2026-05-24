import { NextRequest, NextResponse } from "next/server";
import { resolveMcpGatewayTenantContext } from "@/lib/mcpGatewayAuth";
import { resolveCorrelationId } from "@/lib/licensing";
import { err, handleMcpJsonRpc, mcpCorsHeaders } from "@/lib/mcpGatewayHandler";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTenantPathParam(raw: string): string {
  return raw.trim().toLowerCase();
}

function tenantMatchesPath(params: {
  tenantFromPath: string;
  contextTenantId: string;
  contextTenantSlug: string;
}): boolean {
  const { tenantFromPath, contextTenantId, contextTenantSlug } = params;
  if (!tenantFromPath) return false;
  if (UUID_REGEX.test(tenantFromPath)) {
    return tenantFromPath === contextTenantId.toLowerCase();
  }
  return tenantFromPath === contextTenantSlug.toLowerCase();
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: mcpCorsHeaders });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  return NextResponse.json(
    {
      ok: true,
      service: "olon-mcp-gateway",
      endpoint: `/api/v1/mcp/t/${tenant}`,
      note: "Tenant-scoped MCP endpoint. Bearer token must belong to this tenant.",
      correlationId,
    },
    { headers: mcpCorsHeaders }
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenant: string }> }) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const { tenant: rawTenant } = await ctx.params;
  const tenantFromPath = normalizeTenantPathParam(rawTenant);

  if (!tenantFromPath) {
    return NextResponse.json(err(null, -32602, "Invalid tenant path segment"), {
      status: 400,
      headers: mcpCorsHeaders,
    });
  }

  const context = await resolveMcpGatewayTenantContext(req.headers);
  if (!context) {
    const authHeaders = {
      ...mcpCorsHeaders,
      "WWW-Authenticate":
        `Bearer realm="olon-mcp", authorization_uri="${req.nextUrl.origin}/authorize", token_uri="${req.nextUrl.origin}/token"`,
    };
    return NextResponse.json(err(null, -32001, "Unauthorized"), { status: 401, headers: authHeaders });
  }

  const matches = tenantMatchesPath({
    tenantFromPath,
    contextTenantId: context.tenant.id,
    contextTenantSlug: context.tenant.slug,
  });

  if (!matches) {
    console.warn("[mcp-gateway] tenant mismatch", {
      tenantFromPath,
      contextTenantId: context.tenant.id,
      contextTenantSlug: context.tenant.slug,
      credentialId: context.credential.id,
      clientId: context.credential.client_id,
      correlationId,
    });
    return NextResponse.json(
      err(null, -32002, "Tenant mismatch: credential does not belong to URL tenant", {
        tenantFromPath,
        credentialTenantSlug: context.tenant.slug,
        credentialTenantId: context.tenant.id,
        correlationId,
      }),
      { status: 403, headers: mcpCorsHeaders }
    );
  }

  return handleMcpJsonRpc({ req, context, correlationId });
}
