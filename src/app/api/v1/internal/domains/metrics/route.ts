import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireDomainsAdmin } from "@/lib/internalAdmin";

export const dynamic = "force-dynamic";

function countByEventStatus(rows: Array<{ event_status: string | null }>) {
  const counts = { success: 0, error: 0, pending: 0 };
  for (const row of rows) {
    if (row.event_status === "success") counts.success += 1;
    else if (row.event_status === "error") counts.error += 1;
    else counts.pending += 1;
  }
  return counts;
}

export async function GET(req: NextRequest) {
  const admin = await requireDomainsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error, code: admin.code }, { status: admin.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [eventsRes, pendingDomainsRes, dlqRes] = await Promise.all([
    supabaseAdmin
      .from("tenant_domain_events")
      .select("event_status, created_at")
      .gte("created_at", since)
      .limit(5000),
    supabaseAdmin
      .from("tenant_domains")
      .select("id, status, updated_at")
      .in("status", ["pending_dns", "verifying"])
      .is("deleted_at", null)
      .limit(5000),
    supabaseAdmin
      .from("tenant_domain_dlq")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
  ]);

  if (eventsRes.error || pendingDomainsRes.error || dlqRes.error) {
    return NextResponse.json(
      { error: "Failed to build domain metrics", code: "ERR_DOMAIN_METRICS_READ_FAILED" },
      { status: 500 }
    );
  }

  const counts = countByEventStatus(eventsRes.data ?? []);
  const now = Date.now();
  const stuckVerifying = (pendingDomainsRes.data ?? []).filter((row) => {
    const ts = new Date(row.updated_at).getTime();
    return Number.isFinite(ts) && now - ts > 60 * 60 * 1000;
  }).length;

  return NextResponse.json({
    windowHours: 24,
    events: counts,
    pendingDomains: (pendingDomainsRes.data ?? []).length,
    stuckVerifying,
    dlqBacklog: dlqRes.count ?? 0,
  });
}
