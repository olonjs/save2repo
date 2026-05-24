import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

export type DomainStatus =
  | 'pending_dns'
  | 'verifying'
  | 'verified'
  | 'active'
  | 'conflict'
  | 'error'
  | 'deleted';

export const DOMAIN_MUTATION_LIMIT_PER_HOUR = Number(process.env.DOMAIN_MUTATION_LIMIT_PER_HOUR ?? 30);
export const DOMAIN_MAX_PER_TENANT = Number(process.env.DOMAIN_MAX_PER_TENANT ?? 20);
export const ALLOW_WILDCARD_DOMAINS = process.env.DOMAIN_ALLOW_WILDCARD === '1';

export type DomainVerificationCheck = {
  type: string | null;
  domain: string | null;
  value: string | null;
  reason: string | null;
};

function cleanCheckField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function checkSortRank(type: string | null): number {
  const normalized = (type ?? '').toUpperCase();
  if (normalized === 'A') return 0;
  if (normalized === 'AAAA') return 1;
  if (normalized === 'ALIAS') return 2;
  if (normalized === 'ANAME') return 3;
  if (normalized === 'CNAME') return 4;
  if (normalized === 'TXT') return 0;
  return 5;
}

export function normalizeDomainVerificationChecks(checks: unknown): DomainVerificationCheck[] {
  if (!Array.isArray(checks)) return [];

  const dedupe = new Set<string>();
  const normalized: DomainVerificationCheck[] = [];
  for (const entry of checks) {
    const rawType = cleanCheckField((entry as Record<string, unknown> | null)?.type);
    const rawDomain = cleanCheckField((entry as Record<string, unknown> | null)?.domain);
    const rawValue = cleanCheckField((entry as Record<string, unknown> | null)?.value);
    const rawReason = cleanCheckField((entry as Record<string, unknown> | null)?.reason);

    if (!rawType && !rawDomain && !rawValue) continue;
    const type = rawType ? rawType.toUpperCase() : null;
    const key = `${type ?? ''}|${rawDomain ?? ''}|${rawValue ?? ''}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    normalized.push({
      type,
      domain: rawDomain,
      value: rawValue,
      reason: rawReason,
    });
  }

  normalized.sort((a, b) => {
    const byType = checkSortRank(a.type) - checkSortRank(b.type);
    if (byType !== 0) return byType;
    const byDomain = (a.domain ?? '').localeCompare(b.domain ?? '');
    if (byDomain !== 0) return byDomain;
    return (a.value ?? '').localeCompare(b.value ?? '');
  });
  return normalized;
}

export function fallbackVerificationTargets(domain: string): { checks: DomainVerificationCheck[] } {
  void domain;
  return { checks: [] };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function expandProviderChecks(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const directChecks = asArray(obj.checks);
  const directVerification = asArray(obj.verification);
  const directRequiredDns = asArray(obj.requiredDnsRecords);
  const directDnsRecords = asArray(obj.dnsRecords);
  const directRecords = asArray(obj.records);
  const config = obj.config && typeof obj.config === 'object' ? (obj.config as Record<string, unknown>) : null;
  const recommendedCname = asArray(config?.recommendedCNAME).flatMap((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    return toStringArray(row?.value).map((value) => ({
      type: 'CNAME',
      value,
      reason: 'provider_recommended',
    }));
  });
  const recommendedIPv4 = asArray(config?.recommendedIPv4).flatMap((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    return toStringArray(row?.value).map((value) => ({
      type: 'A',
      value,
      reason: 'provider_recommended',
    }));
  });
  return [
    ...directChecks,
    ...directVerification,
    ...directRequiredDns,
    ...directDnsRecords,
    ...directRecords,
    ...recommendedCname,
    ...recommendedIPv4,
  ];
}

export function extractVerificationTargets(params: {
  domain?: string;
  verificationPayload: unknown;
}): { checks: DomainVerificationCheck[] } {
  const payloadChecks = expandProviderChecks(params.verificationPayload);
  const checksFromProvider = payloadChecks.map((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    return {
      type: cleanCheckField(row?.type) ?? cleanCheckField(row?.recordType),
      domain:
        cleanCheckField(row?.domain) ??
        cleanCheckField(row?.host) ??
        cleanCheckField(row?.name) ??
        cleanCheckField(row?.hostname) ??
        (params.domain ?? null),
      value:
        cleanCheckField(row?.value) ??
        cleanCheckField(row?.target) ??
        cleanCheckField(row?.data) ??
        cleanCheckField(row?.pointsTo),
      reason: cleanCheckField(row?.reason) ?? cleanCheckField(row?.description),
    };
  });
  return { checks: normalizeDomainVerificationChecks(checksFromProvider) };
}

export function resolveCorrelationId(req: NextRequest): string {
  const fromHeader = req.headers.get('x-correlation-id');
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();
  return randomUUID();
}

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

export function isWildcardDomain(domain: string): boolean {
  return domain.startsWith('*.');
}

export function isValidDomainFormat(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized.length > 253) return false;
  if (normalized.includes('://') || normalized.includes('/')) return false;
  if (isWildcardDomain(normalized) && normalized.split('.').length < 3) return false;
  const candidate = normalized.replace(/^\*\./, '');
  const labelRegex = /^[a-z0-9-]{1,63}$/;
  const labels = candidate.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!labelRegex.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
}

export function assertDomainPolicy(domain: string): { ok: true } | { ok: false; status: number; error: string; code: string } {
  const normalized = normalizeDomain(domain);
  if (!isValidDomainFormat(normalized)) {
    return { ok: false, status: 400, error: 'Invalid domain format', code: 'ERR_DOMAIN_INVALID' };
  }
  if (isWildcardDomain(normalized) && !ALLOW_WILDCARD_DOMAINS) {
    return { ok: false, status: 403, error: 'Wildcard domains are disabled', code: 'ERR_DOMAIN_WILDCARD_DISABLED' };
  }
  return { ok: true };
}

export async function assertDomainGovernance(params: {
  userId: string;
  tenantId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  // save2repo: single-owner, no licensing gate on custom domains.
  // The Marketplace subscription is enforced upstream (Vercel native billing).
  const supabaseAdmin = getSupabaseAdmin();
  const { count, error } = await supabaseAdmin
    .from('tenant_domains')
    .select('id', { head: true, count: 'exact' })
    .eq('tenant_id', params.tenantId)
    .is('deleted_at', null);

  if (error) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to check tenant domain quota',
      code: 'ERR_DOMAIN_QUOTA_LOOKUP_FAILED',
    };
  }

  if ((count ?? 0) >= DOMAIN_MAX_PER_TENANT) {
    return {
      ok: false,
      status: 429,
      error: 'Tenant reached technical domain limit',
      code: 'ERR_DOMAIN_LIMIT_REACHED',
    };
  }

  return { ok: true };
}

export async function enforceDomainMutationRateLimit(params: {
  tenantId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  const supabaseAdmin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('tenant_domain_events')
    .select('id', { head: true, count: 'exact' })
    .eq('tenant_id', params.tenantId)
    .eq('actor_user_id', params.userId)
    .in('event_name', ['domain.add.requested', 'domain.remove.requested', 'domain.verify.requested'])
    .gte('created_at', cutoff);

  if (error) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to enforce domain rate limit',
      code: 'ERR_DOMAIN_RATE_LIMIT_LOOKUP_FAILED',
    };
  }

  if ((count ?? 0) >= DOMAIN_MUTATION_LIMIT_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: 'Too many domain mutations in the last hour',
      code: 'ERR_DOMAIN_RATE_LIMITED',
    };
  }
  return { ok: true };
}

export async function appendDomainEvent(params: {
  tenantId: string;
  tenantDomainId?: string | null;
  actorUserId?: string | null;
  eventName: string;
  eventStatus: 'success' | 'error' | 'pending';
  correlationId: string;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from('tenant_domain_events').insert({
    tenant_id: params.tenantId,
    tenant_domain_id: params.tenantDomainId ?? null,
    actor_user_id: params.actorUserId ?? null,
    event_name: params.eventName,
    event_status: params.eventStatus,
    correlation_id: params.correlationId,
    idempotency_key: params.idempotencyKey ?? null,
    payload: params.payload ?? {},
  });
}
