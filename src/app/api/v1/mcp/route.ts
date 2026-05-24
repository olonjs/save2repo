import { NextRequest, NextResponse } from "next/server";
import { resolveMcpGatewayTenantContext } from "@/lib/mcpGatewayAuth";
import { resolveCorrelationId } from "@/lib/correlation";
import { err, handleMcpJsonRpc, mcpCorsHeaders } from "@/lib/mcpGatewayHandler";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: mcpCorsHeaders });
}

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  return NextResponse.json(
    {
      ok: true,
      service: "olon-mcp-gateway",
      endpoint: "/api/v1/mcp",
      note: "Shared endpoint. Prefer tenant-scoped URL: /api/v1/mcp/t/<tenant-slug>.",
      correlationId,
    },
    { headers: mcpCorsHeaders }
  );
}

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const context = await resolveMcpGatewayTenantContext(req.headers);
  if (!context) {
    const authHeaders = {
      ...mcpCorsHeaders,
      "WWW-Authenticate":
        `Bearer realm="olon-mcp", authorization_uri="${req.nextUrl.origin}/authorize", token_uri="${req.nextUrl.origin}/token"`,
    };
    return NextResponse.json(err(null, -32001, "Unauthorized"), { status: 401, headers: authHeaders });
  }

  return handleMcpJsonRpc({ req, context, correlationId });
}
