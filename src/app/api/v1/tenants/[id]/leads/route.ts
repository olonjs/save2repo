import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const url = new URL(req.url);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 10_000);
  const deliveryStatus = url.searchParams.get("status")?.trim() ?? "";

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from("leads")
    .select(
      "id, tenant_id, data, source_ip, user_agent, resend_id, delivery_status, storage_mode, correlation_id, last_error_code, last_error_message, created_at, updated_at",
      { count: "exact" }
    )
    .eq("tenant_id", params.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (deliveryStatus) {
    query = query.eq("delivery_status", deliveryStatus);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to list leads", code: "ERR_LEADS_LIST_FAILED", correlationId },
      { status: 500 }
    );
  }

  return NextResponse.json({
    correlationId,
    tenantId: params.id,
    leads: data ?? [],
    count: count ?? 0,
    limit,
    offset,
  });
}
