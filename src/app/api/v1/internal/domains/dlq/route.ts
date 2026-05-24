import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireDomainsAdmin } from "@/lib/internalAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireDomainsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error, code: admin.code }, { status: admin.status });
  }

  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const onlyPending = req.nextUrl.searchParams.get("pending") !== "0";
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from("tenant_domain_dlq")
    .select(
      "id, tenant_id, tenant_domain_id, operation, domain, attempts, last_error_code, last_error_message, payload, next_retry_at, last_attempt_at, resolved_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (onlyPending) query = query.is("resolved_at", null);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to load domain DLQ", code: "ERR_DOMAIN_DLQ_READ_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    items: data ?? [],
  });
}
