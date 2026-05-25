import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; leadId: string }> }
) {
  const params = await context.params;
  const correlationId = req.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: "editor",
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.data.error, code: access.data.code, correlationId },
      { status: access.data.status }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const lead = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("tenant_id", params.id)
    .eq("id", params.leadId)
    .maybeSingle();
  if (lead.error) {
    return NextResponse.json(
      { error: "Failed to validate lead", code: "ERR_LEAD_LOOKUP_FAILED", correlationId },
      { status: 500 }
    );
  }
  if (!lead.data?.id) {
    return NextResponse.json(
      { error: "Lead not found", code: "ERR_LEAD_NOT_FOUND", correlationId },
      { status: 404 }
    );
  }

  const limit = parsePositiveInt(new URL(req.url).searchParams.get("limit"), 50, 200);
  const { data, error } = await supabaseAdmin
    .from("lead_events")
    .select("id, lead_id, tenant_id, event_name, event_status, correlation_id, idempotency_key, payload, created_at")
    .eq("tenant_id", params.id)
    .eq("lead_id", params.leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load lead events", code: "ERR_LEAD_EVENTS_LIST_FAILED", correlationId },
      { status: 500 }
    );
  }

  return NextResponse.json({
    correlationId,
    tenantId: params.id,
    leadId: params.leadId,
    events: data ?? [],
  });
}
