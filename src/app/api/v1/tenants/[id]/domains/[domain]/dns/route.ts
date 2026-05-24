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
  createDnsRecord,
  listDnsRecords,
  DnsRecordInputSchema,
  type CloudflareApiError,
  type CloudflareDnsRecord,
} from "@/lib/cloudflareApi";
import { isInDomainScope } from "@/lib/domainParsing";
import { logDomain, metricDomain } from "@/lib/domainTelemetry";

export const dynamic = "force-dynamic";

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

const VERCEL_A_IP = "76.76.21.21";

export function isPlatformManagedRecord(record: CloudflareDnsRecord, apexDomain: string): boolean {
  const name = record.name.toLowerCase();
  const apex = apexDomain.toLowerCase();
  const isApexOrWww = name === apex || name === `www.${apex}`;
  if (!isApexOrWww) return false;
  if (record.type === "A" && record.content === VERCEL_A_IP) return true;
  if (record.type === "CNAME" && record.content.toLowerCase().endsWith(".vercel-dns.com")) return true;
  return false;
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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string }> }
) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
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

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const row = await loadDomainRow(params.id, domain);
  if (!row) {
    return NextResponse.json(
      { error: "Domain not found", code: "ERR_DOMAIN_NOT_FOUND", correlationId },
      { status: 404 }
    );
  }
  if (!row.cf_zone_id || row.cf_status !== "active") {
    return NextResponse.json(
      {
        error: "Cloudflare zone is not active for this domain",
        code: "ERR_CF_NOT_ACTIVE",
        correlationId,
      },
      { status: 409 }
    );
  }

  try {
    const records = await listDnsRecords(row.cf_zone_id);
    const subdomainScoped = isSubdomainScope(row);
    const filtered = subdomainScoped ? records.filter((r) => isInDomainScope(r.name, domain)) : records;
    const annotated = filtered.map((record) => ({
      ...record,
      platform_managed: isPlatformManagedRecord(record, domain),
    }));
    return NextResponse.json({ correlationId, records: annotated });
  } catch (error: unknown) {
    const cfError = isCloudflareApiError(error) ? error : null;
    const code = cfError?.code ?? "ERR_CF_DNS_LIST_FAILED";
    const message = cfError?.message ?? "Failed to list Cloudflare DNS records";
    const status = cfError?.status && cfError.status >= 400 ? cfError.status : 502;
    return NextResponse.json({ error: message, code, correlationId }, { status });
  }
}

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

  const rateLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.data.user.id });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: rateLimit.error, code: rateLimit.code, correlationId },
      { status: rateLimit.status }
    );
  }

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const row = await loadDomainRow(params.id, domain);
  if (!row) {
    return NextResponse.json(
      { error: "Domain not found", code: "ERR_DOMAIN_NOT_FOUND", correlationId },
      { status: 404 }
    );
  }
  if (!row.cf_zone_id || row.cf_status !== "active") {
    return NextResponse.json(
      { error: "Cloudflare zone is not active", code: "ERR_CF_NOT_ACTIVE", correlationId },
      { status: 409 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = DnsRecordInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid DNS record input",
        code: "ERR_CF_DNS_INPUT_INVALID",
        correlationId,
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  // OQ-3: default proxy OFF for new A/AAAA/CNAME records (when client omits 'proxied')
  const proxyable = parsed.data.type === "A" || parsed.data.type === "AAAA" || parsed.data.type === "CNAME";
  const input = {
    ...parsed.data,
    proxied: proxyable ? (parsed.data.proxied ?? false) : undefined,
  };

  // Subdomain scoping: when this tenant_domain is a subdomain (cf_zone_apex != domain),
  // the record name MUST be the tenant fqdn itself or a child label of it. Reject "@"
  // (which on CF means the zone apex) because it would create a record on the parent
  // zone shared with other tenants.
  if (isSubdomainScope(row)) {
    const rawName = input.name.trim().toLowerCase();
    if (rawName === "@" || rawName === "") {
      return NextResponse.json(
        {
          error: `Use the full domain "${domain}" (or a child like "sub.${domain}") as record name. "@" is not allowed because it refers to the parent zone apex.`,
          code: "ERR_CF_RECORD_OUT_OF_SCOPE",
          correlationId,
        },
        { status: 403 }
      );
    }
    if (!isInDomainScope(rawName, domain)) {
      return NextResponse.json(
        {
          error: `Record name "${input.name}" is outside the scope of "${domain}". Only the tenant fqdn and its sub-labels are allowed.`,
          code: "ERR_CF_RECORD_OUT_OF_SCOPE",
          correlationId,
        },
        { status: 403 }
      );
    }
  }

  try {
    const record = await createDnsRecord(row.cf_zone_id, input);
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: row.id,
      actorUserId: auth.data.user.id,
      eventName: "cf_dns_record_create",
      eventStatus: "success",
      correlationId,
      idempotencyKey,
      payload: { record_id: record.id, type: record.type, name: record.name },
    });
    metricDomain("cf_dns_record_create_success", 1, {});
    return NextResponse.json({
      correlationId,
      record: { ...record, platform_managed: isPlatformManagedRecord(record, domain) },
    });
  } catch (error: unknown) {
    const cfError = isCloudflareApiError(error) ? error : null;
    const code = cfError?.code ?? "ERR_CF_DNS_CREATE_FAILED";
    const message = cfError?.message ?? "Failed to create DNS record";
    const status = cfError?.status && cfError.status >= 400 ? cfError.status : 502;

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: row.id,
      actorUserId: auth.data.user.id,
      eventName: "cf_dns_record_create",
      eventStatus: "error",
      correlationId,
      idempotencyKey,
      payload: { code, message, input: parsed.data },
    });
    logDomain("error", "cf.dns.create.failed", { tenantId: params.id, domain, code, correlationId });
    metricDomain("cf_dns_record_create_failed", 1, { code });

    return NextResponse.json({ error: message, code, correlationId }, { status });
  }
}
