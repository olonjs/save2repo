import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";
import { a2aCorsHeaders, err, extractToolArguments, ok, type JsonRpcRequest } from "@/lib/a2a/jsonRpc";
import { executeA2aReadContent } from "@/lib/a2a/readContent";
import { executeA2aSubmitForm } from "@/lib/a2a/submitForm";

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
  {
    name: "submit-form",
    description:
      "Submit a contact, booking, or inquiry form on the tenant's website on the user's behalf. The exact shape of the fields each form expects is returned by read-content under `sectionSubmissionSchemas[sectionType]` — always read-content the target page first to plan the `data` payload. The destination email address is configured by the tenant and cannot be changed by the agent.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug of the page hosting the form (default: home)." },
        sectionId: { type: "string", description: "Concrete section instance id of the form to submit against." },
        data: {
          type: "object",
          description:
            "Submission payload collected from the user. Must conform to sectionSubmissionSchemas[sectionType] from the tenant page contract. Do not include recipientEmail — it is resolved server-side from the section config.",
        },
      },
      required: ["sectionId", "data"],
      additionalProperties: false,
    },
    annotations: {
      title: "Submit a form on the tenant site",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

async function resolveTenantBySlug(slug: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("id,slug,api_key")
    .eq("slug", slug)
    .maybeSingle<{ id: string; slug: string; api_key: string }>();
  if (error || !data?.id || !data.api_key) return null;
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

    if (toolName === "submit-form") {
      return executeA2aSubmitForm({ req, tenant, correlationId, id, args });
    }

    return NextResponse.json(err(id, -32601, `Unknown tool: ${toolName}`), { status: 404, headers: a2aCorsHeaders });
  }

  return NextResponse.json(err(id, -32601, `Unsupported method: ${method}`), { status: 404, headers: a2aCorsHeaders });
}
