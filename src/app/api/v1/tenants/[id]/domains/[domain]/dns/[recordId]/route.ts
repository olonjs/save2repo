import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireRequestUser, assertTenantAccess } from "@/lib/serverAuth";
import {
  appendDomainEvent,
  enforceDomainMutationRateLimit,
  normalizeDomain,
  resolveCorrelationId,
} from "@/lib/customDomains";
import {
  deleteDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  DnsRecordInputSchema,
  type CloudflareApiError,
  type CloudflareDnsRecord,
} from "@/lib/cloudflareApi";
import { isInDomainScope } from "@/lib/domainParsing";
import { logDomain, metricDomain } from "@/lib/domainTelemetry";

export const dynamic = "force-dynamic";

const VERCEL_A_IP = "76.76.21.21";

function isPlatformManagedRecord(record: CloudflareDnsRecord, apexDomain: string): boolean {
  const name = record.name.toLowerCase();
  const apex = apexDomain.toLowerCase();
  const isApexOrWww = name === apex || name === `www.${apex}`;
  if (!isApexOrWww) return false;
  if (record.type === "A" && record.content === VERCEL_A_IP) return true;
  if (record.type === "CNAME" && record.content.toLowerCase().endsWith(".vercel-dns.com")) return true;
  return false;
}

type DomainRow = {
  id: string;
  domain: string;
  cf_zone_id: string | null;
  cf_status: string | null;
  cf_zone_apex: string | null;
};

function isSubdomainScope(row: DomainRow): boolean {
  return !!row.cf_zone_apex && row.cf_zone_apex.toLowerCase() !== row.domain.toLowerCase();
}

function isCloudflareApiError(error: unknown): error is CloudflareApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

async function loadDomainRow(tenantId: string, domain: string): Promise<DomainRow | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("tenant_domains")
    .select("id, domain, cf_zone_id, cf_status, cf_zone_apex")
    .eq("tenant_id", tenantId)
    .eq("domain", domain)
    .is("deleted_at", null)
    .maybeSingle<DomainRow>();
  return data ?? null;
}

async function authenticateAndLoad(
  req: NextRequest,
  params: { id: string; domain: string }
): Promise<
  | { ok: true; userId: string; row: DomainRow; domain: string; correlationId: string }
  | { ok: false; response: NextResponse }
> {
  const correlationId = resolveCorrelationId(req);
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status }),
    };
  }
  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: "editor",
  });
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: access.data.error, code: access.data.code, correlationId },
        { status: access.data.status }
      ),
    };
  }

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const row = await loadDomainRow(params.id, domain);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Domain not found", code: "ERR_DOMAIN_NOT_FOUND", correlationId },
        { status: 404 }
      ),
    };
  }
  if (!row.cf_zone_id || row.cf_status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cloudflare zone is not active", code: "ERR_CF_NOT_ACTIVE", correlationId },
        { status: 409 }
      ),
    };
  }
  return { ok: true, userId: auth.data.user.id, row, domain, correlationId };
}

async function findRecord(
  zoneId: string,
  recordId: string
): Promise<CloudflareDnsRecord | null> {
  const records = await listDnsRecords(zoneId);
  return records.find((r) => r.id === recordId) ?? null;
}

const PatchSchema = DnsRecordInputSchema.partial();

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string; recordId: string }> }
) {
  const params = await context.params;
  const auth = await authenticateAndLoad(req, params);
  if (!auth.ok) return auth.response;

  const rateLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.userId });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: rateLimit.error, code: rateLimit.code, correlationId: auth.correlationId },
      { status: rateLimit.status }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid DNS record patch",
        code: "ERR_CF_DNS_PATCH_INVALID",
        correlationId: auth.correlationId,
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const zoneId = auth.row.cf_zone_id as string;
  const existing = await findRecord(zoneId, params.recordId).catch(() => null);
  if (!existing) {
    return NextResponse.json(
      { error: "DNS record not found", code: "ERR_CF_RECORD_NOT_FOUND", correlationId: auth.correlationId },
      { status: 404 }
    );
  }
  if (isSubdomainScope(auth.row) && !isInDomainScope(existing.name, auth.domain)) {
    return NextResponse.json(
      {
        error: `Record "${existing.name}" is outside the scope of "${auth.domain}".`,
        code: "ERR_CF_RECORD_OUT_OF_SCOPE",
        correlationId: auth.correlationId,
      },
      { status: 403 }
    );
  }
  if (isPlatformManagedRecord(existing, auth.domain)) {
    return NextResponse.json(
      {
        error: "Record is managed by the platform and cannot be modified",
        code: "ERR_CF_RECORD_LOCKED",
        correlationId: auth.correlationId,
      },
      { status: 403 }
    );
  }

  try {
    const updated = await updateDnsRecord(zoneId, params.recordId, parsed.data);
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: auth.row.id,
      actorUserId: auth.userId,
      eventName: "cf_dns_record_update",
      eventStatus: "success",
      correlationId: auth.correlationId,
      payload: { record_id: updated.id, patch: parsed.data },
    });
    metricDomain("cf_dns_record_update_success", 1, {});
    return NextResponse.json({
      correlationId: auth.correlationId,
      record: { ...updated, platform_managed: isPlatformManagedRecord(updated, auth.domain) },
    });
  } catch (error: unknown) {
    const cfError = isCloudflareApiError(error) ? error : null;
    const code = cfError?.code ?? "ERR_CF_DNS_UPDATE_FAILED";
    const message = cfError?.message ?? "Failed to update DNS record";
    const status = cfError?.status && cfError.status >= 400 ? cfError.status : 502;
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: auth.row.id,
      actorUserId: auth.userId,
      eventName: "cf_dns_record_update",
      eventStatus: "error",
      correlationId: auth.correlationId,
      payload: { code, message },
    });
    logDomain("error", "cf.dns.update.failed", { tenantId: params.id, code, correlationId: auth.correlationId });
    metricDomain("cf_dns_record_update_failed", 1, { code });
    return NextResponse.json({ error: message, code, correlationId: auth.correlationId }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string; recordId: string }> }
) {
  const params = await context.params;
  const auth = await authenticateAndLoad(req, params);
  if (!auth.ok) return auth.response;

  const rateLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.userId });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: rateLimit.error, code: rateLimit.code, correlationId: auth.correlationId },
      { status: rateLimit.status }
    );
  }

  const zoneId = auth.row.cf_zone_id as string;
  const existing = await findRecord(zoneId, params.recordId).catch(() => null);
  if (!existing) {
    return NextResponse.json(
      { error: "DNS record not found", code: "ERR_CF_RECORD_NOT_FOUND", correlationId: auth.correlationId },
      { status: 404 }
    );
  }
  if (isSubdomainScope(auth.row) && !isInDomainScope(existing.name, auth.domain)) {
    return NextResponse.json(
      {
        error: `Record "${existing.name}" is outside the scope of "${auth.domain}".`,
        code: "ERR_CF_RECORD_OUT_OF_SCOPE",
        correlationId: auth.correlationId,
      },
      { status: 403 }
    );
  }
  if (isPlatformManagedRecord(existing, auth.domain)) {
    return NextResponse.json(
      {
        error: "Record is managed by the platform and cannot be deleted",
        code: "ERR_CF_RECORD_LOCKED",
        correlationId: auth.correlationId,
      },
      { status: 403 }
    );
  }

  try {
    const out = await deleteDnsRecord(zoneId, params.recordId);
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: auth.row.id,
      actorUserId: auth.userId,
      eventName: "cf_dns_record_delete",
      eventStatus: "success",
      correlationId: auth.correlationId,
      payload: { record_id: out.id },
    });
    metricDomain("cf_dns_record_delete_success", 1, {});
    return NextResponse.json({ correlationId: auth.correlationId, deleted: { id: out.id } });
  } catch (error: unknown) {
    const cfError = isCloudflareApiError(error) ? error : null;
    const code = cfError?.code ?? "ERR_CF_DNS_DELETE_FAILED";
    const message = cfError?.message ?? "Failed to delete DNS record";
    const status = cfError?.status && cfError.status >= 400 ? cfError.status : 502;
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: auth.row.id,
      actorUserId: auth.userId,
      eventName: "cf_dns_record_delete",
      eventStatus: "error",
      correlationId: auth.correlationId,
      payload: { code, message },
    });
    logDomain("error", "cf.dns.delete.failed", { tenantId: params.id, code, correlationId: auth.correlationId });
    metricDomain("cf_dns_record_delete_failed", 1, { code });
    return NextResponse.json({ error: message, code, correlationId: auth.correlationId }, { status });
  }
}

