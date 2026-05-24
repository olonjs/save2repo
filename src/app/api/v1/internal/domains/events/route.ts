import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireDomainsAdmin } from "@/lib/internalAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireDomainsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error, code: admin.code }, { status: admin.status });
  }

  const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 100)));
  const tenantId = req.nextUrl.searchParams.get("tenant_id")?.trim() ?? null;
  const domain = req.nextUrl.searchParams.get("domain")?.trim().toLowerCase() ?? null;

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from("tenant_domain_events")
    .select(
      "id, tenant_id, tenant_domain_id, actor_user_id, event_name, event_status, correlation_id, payload, created_at, tenant_domains:tenant_domain_id(domain)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tenantId) query = query.eq("tenant_id", tenantId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to read domain events", code: "ERR_DOMAIN_EVENTS_READ_FAILED" },
      { status: 500 }
    );
  }

  const items = (data ?? [])
    .map((row: any) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_domain_id: row.tenant_domain_id,
    actor_user_id: row.actor_user_id,
    event_name: row.event_name,
    event_status: row.event_status,
    correlation_id: row.correlation_id,
    payload: row.payload ?? {},
    created_at: row.created_at,
      domain: row.tenant_domains?.domain ?? null,
    }))
    .filter((row) => (!domain ? true : row.domain === domain));

  return NextResponse.json({ items });
}
