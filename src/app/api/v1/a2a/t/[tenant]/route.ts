import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/correlation";
import { a2aCorsHeaders, err, extractToolArguments, ok, type JsonRpcRequest } from "@/lib/a2a/jsonRpc";
import { executeA2aReadContent } from "@/lib/a2a/readContent";
// save2repo: submit-form tool removed (forms out-of-scope at day-1; T-1xx may reintroduce).

export const dynamic = "force-dynamic";

const A2A_TOOLS = [
  {
    name: "read-content",
    description:
      "Fetch the current content of a tenant page by slug, including every section and its data. The response includes `sectionSubmissionSchemas` (input shape of form-capable sections, keyed by section type — plan submit-form against this). Always call this first when the user asks about a page or before submitting a form.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Page slug to read (default: home). Example values: home, about, contatti." },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Read a tenant page's current content",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

async function resolveTenantBySlug(slug: string) {
  // save2repo schema: tenants has no `api_key` column; A2A endpoint is
  // unauthenticated by design (public read-content / submit-form). Tenant
  // resolution returns just identity.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("id,slug")
    .eq("slug", slug)
    .maybeSingle<{ id: string; slug: string }>();
  if (error || !data?.id) return null;
  return data;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: a2aCorsHeaders });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  return NextResponse.json(
    {
      ok: true,
      service: "olon-a2a-gateway",
      endpoint: `/api/v1/a2a/t/${tenant}`,
      note: "Public A2A endpoint. Exposes read-content and submit-form. No authentication required.",
      tools: A2A_TOOLS.map((tool) => tool.name),
      correlationId,
    },
    { headers: a2aCorsHeaders }
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenant: string }> }) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const { tenant: rawTenant } = await ctx.params;
  const tenantSlug = rawTenant.trim().toLowerCase();

  if (!tenantSlug) {
    return NextResponse.json(err(null, -32602, "Invalid tenant path segment"), {
      status: 400,
      headers: a2aCorsHeaders,
    });
  }

  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(err(null, -32001, `Tenant not found: ${tenantSlug}`), {
      status: 404,
      headers: a2aCorsHeaders,
    });
  }

  const body = (await req.json().catch(() => ({}))) as JsonRpcRequest;
  const id = body.id ?? null;
  const method = body.method ?? "";

  if (!method) {
    return NextResponse.json(err(id, -32600, "Invalid request"), { status: 400, headers: a2aCorsHeaders });
  }

  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202, headers: a2aCorsHeaders });
  }

  if (method === "initialize") {
    return NextResponse.json(
      ok(id, {
        protocolVersion: body.params?.protocolVersion ?? "2024-11-05",
        serverInfo: { name: "olon-a2a-gateway", version: "0.2.0" },
        capabilities: { tools: {} },
        correlationId,
      }),
      { headers: a2aCorsHeaders }
    );
  }

  if (method === "tools/list") {
    return NextResponse.json(ok(id, { tools: A2A_TOOLS, correlationId }), { headers: a2aCorsHeaders });
  }

  if (method === "tools/call") {
    const toolName = typeof body.params?.name === "string" ? body.params.name : "";
    const args = extractToolArguments(body.params);

    if (toolName === "read-content") {
      return executeA2aReadContent({ tenant, correlationId, id, args });
    }

    return NextResponse.json(err(id, -32601, `Unknown tool: ${toolName}`), { status: 404, headers: a2aCorsHeaders });
  }

  return NextResponse.json(err(id, -32601, `Unsupported method: ${method}`), { status: 404, headers: a2aCorsHeaders });
}
