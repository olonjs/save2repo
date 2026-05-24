import { NextRequest, NextResponse } from "next/server";
import { hasScope, type McpGatewayTenantContext } from "@/lib/mcpGatewayAuth";

// ============================================================================
// save2repo MCP gateway handler — Phase 0 stub.
//
// The full MCP gateway is the product's moat (ADR-006 + spec). The parent
// jsonpages-platform implementation backed read-content / hot-save /
// submit-form via the centralized `tenant_content_store` (Supabase) +
// submission schema infra. ADR-005 removes that store; ADR-006 reroutes
// GitHub writes through the olonjs token-signing endpoint.
//
// The full reimplementation lands in **T-110** (Phase 1):
//   - read-content   → fetch via GitHub Contents API on the tenant repo
//   - cold-save      → commit + Vercel rebuild via saveRepoCommitDeploy
//   - update-section → mutate page JSON in-memory, defer to cold-save
//   - whoami         → diagnostic, already works here in Phase 0
//
// Day-1 surface = `initialize` + `tools/list` (advertised) + `tools/call whoami`.
// All other tool calls return -32601 with a clear "not yet implemented" body so
// MCP clients (Claude Desktop, ChatGPT custom GPTs, A2A peers) see a useful
// error instead of crashing.
// ============================================================================

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export const mcpCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Correlation-Id",
};

export function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function notImplemented(id: string | number | null, toolName: string, correlationId: string): NextResponse {
  return NextResponse.json(
    err(id, -32601, `Tool '${toolName}' not yet implemented in save2repo Phase 0`, {
      code: "ERR_TOOL_NOT_IMPLEMENTED",
      tool: toolName,
      reimplementedIn: "T-110",
      correlationId,
    }),
    { status: 501, headers: mcpCorsHeaders }
  );
}

const TOOLS_LIST = [
  {
    name: "whoami",
    description:
      "Show which tenant this MCP session is authenticated for, along with the credential label and granted scopes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Identify the current tenant", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "read-content",
    description:
      "Fetch the current content of a tenant page. (Phase 0: returns -32601; reimplemented in T-110 via GitHub Contents API.)",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Page slug to read (default: home)." } },
      additionalProperties: false,
    },
    annotations: { title: "Read a tenant page (T-110)", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "cold-save",
    description:
      "Commit the tenant's pending content to its git repo (triggers Vercel rebuild). (Phase 0: returns -32601; reimplemented in T-110.)",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "Optional commit message." } },
      additionalProperties: false,
    },
    annotations: { title: "Cold save (T-110)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "navigate-to-page",
    description:
      "Declare which page you'll be working on next (stateless acknowledgement). (Phase 0: returns -32601.)",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: { title: "Set the working page context (T-110)", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update-section",
    description:
      "Mutate one section of a page in-memory and stage for cold-save. (Phase 0: returns -32601; reimplemented in T-110.)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        sectionId: { type: "string" },
        data: { type: "object" },
      },
      required: ["sectionId", "data"],
      additionalProperties: true,
    },
    annotations: { title: "Update one section (T-110)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

export async function handleMcpJsonRpc(params: {
  req: NextRequest;
  context: McpGatewayTenantContext;
  correlationId: string;
  bodyOverride?: JsonRpcRequest;
}): Promise<NextResponse> {
  const { req, context, correlationId, bodyOverride } = params;
  const body = bodyOverride ?? ((await req.json().catch(() => ({}))) as JsonRpcRequest);
  const id = body.id ?? null;
  const method = body.method ?? "";

  if (!method) {
    return NextResponse.json(err(id, -32600, "Invalid request"), { status: 400, headers: mcpCorsHeaders });
  }

  // MCP one-way notifications: no JSON-RPC response (202 Accepted, empty body).
  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202, headers: mcpCorsHeaders });
  }

  if (method === "initialize") {
    return NextResponse.json(
      ok(id, {
        protocolVersion: body.params?.protocolVersion ?? "2024-11-05",
        serverInfo: { name: "save2repo-mcp-gateway", version: "0.1.0" },
        capabilities: { tools: {} },
        correlationId,
      }),
      { headers: mcpCorsHeaders }
    );
  }

  if (method === "tools/list") {
    return NextResponse.json(ok(id, { tools: TOOLS_LIST, correlationId }), { headers: mcpCorsHeaders });
  }

  if (method === "tools/call") {
    const toolName = typeof body.params?.name === "string" ? body.params.name : "";

    if (toolName === "whoami") {
      if (!hasScope(context.credential.scopes, "read")) {
        return NextResponse.json(err(id, -32003, "Forbidden: missing read scope"), {
          status: 403,
          headers: mcpCorsHeaders,
        });
      }
      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tenantId: context.tenant.id,
                  tenantSlug: context.tenant.slug,
                  credentialId: context.credential.id,
                  credentialLabel: context.credential.label,
                  clientId: context.credential.client_id,
                  scopes: context.credential.scopes,
                  authMode: context.authMode,
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    // All other tools are advertised in tools/list (so MCP clients can see what
    // is coming) but not yet wired. T-110 reimplements them.
    if (["read-content", "cold-save", "navigate-to-page", "update-section"].includes(toolName)) {
      return notImplemented(id, toolName, correlationId);
    }

    return NextResponse.json(err(id, -32601, `Unknown tool: ${toolName}`), {
      status: 404,
      headers: mcpCorsHeaders,
    });
  }

  return NextResponse.json(err(id, -32601, `Unsupported method: ${method}`), {
    status: 404,
    headers: mcpCorsHeaders,
  });
}

// Silence unused-imports of NextRequest in production builds where the route
// adapter re-exports — kept here for the live signature.
void NextRequest;
