"use client";

import { supabase } from "@/lib/supabase";
import type { DomainApiError, DomainRecord, DnsRecord, DnsRecordInput } from "./types";

function normalizeError(payload: any, status?: number): DomainApiError {
  return {
    message: typeof payload?.error === "string" ? payload.error : "Request failed",
    code: typeof payload?.code === "string" ? payload.code : null,
    status,
  };
}

async function authHeaders(extra?: Record<string, string>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw <DomainApiError>{ message: "Session missing or expired", code: "ERR_SESSION_MISSING", status: 401 };
  }
  return {
    Authorization: `Bearer ${token}`,
    "X-Correlation-Id": crypto.randomUUID(),
    ...(extra ?? {}),
  };
}

function normalizeDomainRecord(row: any): DomainRecord {
  const verificationTargets = row?.verification_targets ?? row?.verificationTargets ?? null;
  return {
    ...(row ?? {}),
    verification_targets: verificationTargets,
  } as DomainRecord;
}

export async function apiListDomains(tenantId: string): Promise<DomainRecord[]> {
  const headers = await authHeaders();
  const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/domains`, {
    method: "GET",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return Array.isArray(data?.domains) ? data.domains.map(normalizeDomainRecord) : [];
}

export async function apiAddDomain(tenantId: string, domain: string): Promise<DomainRecord> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/domains`, {
    method: "POST",
    headers,
    body: JSON.stringify({ domain }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return normalizeDomainRecord(data?.domain ?? null);
}

export async function apiRefreshDomain(tenantId: string, domain: string, verify = false): Promise<DomainRecord> {
  const headers = await authHeaders();
  const encodedDomain = encodeURIComponent(domain);
  const endpoint = verify
    ? `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodedDomain}/verify`
    : `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodedDomain}`;
  const res = await fetch(endpoint, {
    method: verify ? "POST" : "GET",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return normalizeDomainRecord(data?.domain ?? null);
}

export async function apiCfBootstrap(
  tenantId: string,
  domain: string
): Promise<{ cf_zone_id: string; cf_status: string; name_servers: string[] }> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/cf-bootstrap`,
    {
      method: "POST",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return {
    cf_zone_id: data.cf_zone_id,
    cf_status: data.cf_status,
    name_servers: Array.isArray(data.name_servers) ? data.name_servers : [],
  };
}

export async function apiCfDisconnect(
  tenantId: string,
  domain: string
): Promise<{ cf_status: string; cf_zone_id: string }> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/cf-disconnect`,
    { method: "POST", headers }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return { cf_status: data.cf_status, cf_zone_id: data.cf_zone_id };
}

export async function apiListDnsRecords(tenantId: string, domain: string): Promise<DnsRecord[]> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns`,
    { method: "GET", headers }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return Array.isArray(data?.records) ? (data.records as DnsRecord[]) : [];
}

export async function apiCreateDnsRecord(
  tenantId: string,
  domain: string,
  input: DnsRecordInput
): Promise<DnsRecord> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns`,
    { method: "POST", headers, body: JSON.stringify(input) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return data.record as DnsRecord;
}

export async function apiUpdateDnsRecord(
  tenantId: string,
  domain: string,
  recordId: string,
  patch: Partial<DnsRecordInput>
): Promise<DnsRecord> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`,
    { method: "PATCH", headers, body: JSON.stringify(patch) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return data.record as DnsRecord;
}

export async function apiDeleteDnsRecord(
  tenantId: string,
  domain: string,
  recordId: string
): Promise<{ id: string }> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`,
    { method: "DELETE", headers }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return data.deleted as { id: string };
}

export async function apiRemoveDomain(tenantId: string, domain: string): Promise<DomainRecord> {
  const headers = await authHeaders({
    "Idempotency-Key": crypto.randomUUID(),
  });
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}`,
    {
      method: "DELETE",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return normalizeDomainRecord(data?.domain ?? null);
}
