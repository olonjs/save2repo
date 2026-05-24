import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireRequestUser, assertTenantAccess } from "@/lib/serverAuth";
import {
  appendDomainEvent,
  enforceDomainMutationRateLimit,
  normalizeDomain,
  resolveCorrelationId,
} from "@/lib/customDomains";
import { logDomain, metricDomain } from "@/lib/domainTelemetry";

export const dynamic = "force-dynamic";

type DomainRow = {
  id: string;
  domain: string;
  cf_zone_id: string | null;
  cf_status: string | null;
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string }> }
) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? null;

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

  const rateLimit = await enforceDomainMutationRateLimit({
    tenantId: params.id,
    userId: auth.data.user.id,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: rateLimit.error, code: rateLimit.code, correlationId },
      { status: rateLimit.status }
    );
  }

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const supabaseAdmin = getSupabaseAdmin();
  const { data: row } = await supabaseAdmin
    .from("tenant_domains")
    .select("id, domain, cf_zone_id, cf_status")
    .eq("tenant_id", params.id)
    .eq("domain", domain)
    .is("deleted_at", null)
    .maybeSingle<DomainRow>();

  if (!row) {
    return NextResponse.json(
      { error: "Domain not found", code: "ERR_DOMAIN_NOT_FOUND", correlationId },
      { status: 404 }
    );
  }
  if (!row.cf_zone_id) {
    return NextResponse.json(
      { error: "Cloudflare not connected for this domain", code: "ERR_CF_NOT_CONNECTED", correlationId },
      { status: 409 }
    );
  }

  // OQ-2: MVP + solo unlink. Lasciamo la zona viva su CF.
  const { error: updateError } = await supabaseAdmin
    .from("tenant_domains")
    .update({
      cf_status: "disconnected",
      cf_zone_status_checked_at: new Date().toISOString(),
      cf_last_error_code: null,
      cf_last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (updateError) {
    return NextResponse.json(
      {
        error: "Failed to persist disconnect",
        code: "ERR_CF_DISCONNECT_PERSIST_FAILED",
        correlationId,
      },
      { status: 500 }
    );
  }

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: row.id,
    actorUserId: auth.data.user.id,
    eventName: "cf_disconnect",
    eventStatus: "success",
    correlationId,
    idempotencyKey,
    payload: { cf_zone_id: row.cf_zone_id, mode: "unlink" },
  });

  logDomain("info", "cf.disconnect.unlink", {
    tenantId: params.id,
    domain,
    cf_zone_id: row.cf_zone_id,
    correlationId,
  });
  metricDomain("cf_disconnect_unlink", 1, {});

  return NextResponse.json({
    correlationId,
    cf_status: "disconnected",
    cf_zone_id: row.cf_zone_id,
    mode: "unlink",
  });
}
