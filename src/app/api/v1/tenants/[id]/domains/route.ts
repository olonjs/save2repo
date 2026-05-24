import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireRequestUser, assertTenantAccess } from '@/lib/serverAuth';
import {
  appendDomainEvent,
  assertDomainGovernance,
  assertDomainPolicy,
  enforceDomainMutationRateLimit,
  extractVerificationTargets,
  fallbackVerificationTargets,
  normalizeDomain,
  resolveCorrelationId,
} from '@/lib/customDomains';
import { vercelAddDomain, vercelGetDomainConfig, vercelGetDomainStatus } from '@/lib/vercelDomains';
import { logDomain, metricDomain } from '@/lib/domainTelemetry';
import { deriveDomainStatusFromVercel } from '@/lib/domainStatus';

export const dynamic = 'force-dynamic';

async function resolveExistingDomainOnConflict(params: {
  tenantId: string;
  domain: string;
  correlationId: string;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: existingDomain } = await supabaseAdmin
    .from('tenant_domains')
    .select('id, tenant_id, domain, status, verification_targets, verified_at')
    .eq('domain', params.domain)
    .is('deleted_at', null)
    .maybeSingle();
  if (existingDomain?.id && existingDomain.tenant_id === params.tenantId) {
    return NextResponse.json({
      correlationId: params.correlationId,
      tenantId: params.tenantId,
      domain: existingDomain,
      reused: true,
    });
  }
  return NextResponse.json(
    { error: 'Domain already associated with another tenant', code: 'ERR_DOMAIN_CONFLICT', correlationId: params.correlationId },
    { status: 409 }
  );
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
  const auth = await requireRequestUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: 'editor',
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.data.error, code: access.data.code, correlationId },
      { status: access.data.status }
    );
  }

  const governance = await assertDomainGovernance({ userId: auth.data.user.id, tenantId: params.id });
  if (!governance.ok) {
    return NextResponse.json({ error: governance.error, code: governance.code, correlationId }, { status: governance.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('tenant_domains')
    .select(
      'id, domain, status, verification_method, verification_targets, created_at, updated_at, verified_at, last_error_code, last_error_message, cf_zone_id, cf_nameservers, cf_status, cf_attached_at, cf_last_error_code, cf_last_error_message'
    )
    .eq('tenant_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    logDomain('error', 'domain.list.failed', { tenantId: params.id, correlationId });
    return NextResponse.json(
      { error: 'Failed to list tenant domains', code: 'ERR_DOMAIN_LIST_FAILED', correlationId },
      { status: 500 }
    );
  }

  metricDomain('domain_list_success', 1, { tenantId: params.id });
  return NextResponse.json({ correlationId, tenantId: params.id, domains: data ?? [] });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
  const auth = await requireRequestUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: 'admin',
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.data.error, code: access.data.code, correlationId },
      { status: access.data.status }
    );
  }

  const governance = await assertDomainGovernance({ userId: auth.data.user.id, tenantId: params.id });
  if (!governance.ok) {
    return NextResponse.json({ error: governance.error, code: governance.code, correlationId }, { status: governance.status });
  }

  const mutationLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.data.user.id });
  if (!mutationLimit.ok) {
    return NextResponse.json(
      { error: mutationLimit.error, code: mutationLimit.code, correlationId },
      { status: mutationLimit.status }
    );
  }

  const body = await req.json().catch(() => ({}));
  const domainRaw = typeof body?.domain === 'string' ? body.domain : '';
  const domain = normalizeDomain(domainRaw);
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? null;

  const policy = assertDomainPolicy(domain);
  if (!policy.ok) {
    return NextResponse.json({ error: policy.error, code: policy.code, correlationId }, { status: policy.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (idempotencyKey) {
    const previous = await supabaseAdmin
      .from('tenant_domain_events')
      .select('payload')
      .eq('tenant_id', params.id)
      .eq('actor_user_id', auth.data.user.id)
      .eq('event_name', 'domain.add.completed')
      .eq('idempotency_key', idempotencyKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousResponse = previous.data?.payload?.response;
    if (previousResponse && typeof previousResponse === 'object') {
      return NextResponse.json({ correlationId, idempotentReplay: true, ...previousResponse });
    }
  }

  const { data: existingDomain } = await supabaseAdmin
    .from('tenant_domains')
    .select('id, tenant_id, domain, status, verification_targets, verified_at')
    .eq('domain', domain)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingDomain?.id && existingDomain.tenant_id === params.id) {
    return NextResponse.json({
      correlationId,
      tenantId: params.id,
      domain: existingDomain,
      reused: true,
    });
  }
  if (existingDomain?.id && existingDomain.tenant_id !== params.id) {
    return NextResponse.json(
      { error: 'Domain already associated with another tenant', code: 'ERR_DOMAIN_CONFLICT', correlationId },
      { status: 409 }
    );
  }

  if (!access.data.tenant.vercel_project_id) {
    return NextResponse.json(
      { error: 'Tenant has no Vercel project configured', code: 'ERR_VERCEL_PROJECT_MISSING', correlationId },
      { status: 409 }
    );
  }

  const insertedDomain = await supabaseAdmin
    .from('tenant_domains')
    .insert({
      tenant_id: params.id,
      domain,
      status: 'pending_dns',
      verification_method: 'dns',
      verification_targets: fallbackVerificationTargets(domain),
      created_by: auth.data.user.id,
      updated_by: auth.data.user.id,
    })
    .select('id, domain, status')
    .single();

  if (insertedDomain.error || !insertedDomain.data?.id) {
    if (insertedDomain.error?.code === '23505') {
      return resolveExistingDomainOnConflict({ tenantId: params.id, domain, correlationId });
    }
    return NextResponse.json(
      { error: 'Failed to persist tenant domain', code: 'ERR_DOMAIN_PERSIST_FAILED', correlationId },
      { status: 500 }
    );
  }

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: insertedDomain.data.id,
    actorUserId: auth.data.user.id,
    eventName: 'domain.add.requested',
    eventStatus: 'pending',
    correlationId,
    idempotencyKey,
    payload: { domain },
  });

  try {
    await vercelAddDomain(access.data.tenant.vercel_project_id, domain);
    const vercelStatus = await vercelGetDomainStatus(access.data.tenant.vercel_project_id, domain);
    const vercelConfig = await vercelGetDomainConfig(access.data.tenant.vercel_project_id, domain).catch(() => null);
    const providerPayload = { ...vercelStatus, config: vercelConfig };
    const finalVerificationTargets = extractVerificationTargets({
      domain,
      verificationPayload: providerPayload,
    });
    const status = deriveDomainStatusFromVercel(providerPayload, finalVerificationTargets.checks.length).status;
    const updatedAt = new Date().toISOString();
    const verifiedAt = status === 'active' ? updatedAt : null;

    await supabaseAdmin
      .from('tenant_domains')
      .update({
        status,
        verification_targets: finalVerificationTargets,
        last_vercel_payload: providerPayload,
        verified_at: verifiedAt,
        updated_by: auth.data.user.id,
        updated_at: updatedAt,
      })
      .eq('id', insertedDomain.data.id);

    const responsePayload = {
      tenantId: params.id,
      domain: {
        id: insertedDomain.data.id,
        domain,
        status,
        verification_targets: finalVerificationTargets,
        updated_at: updatedAt,
        verified_at: verifiedAt,
      },
    };

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: insertedDomain.data.id,
      actorUserId: auth.data.user.id,
      eventName: 'domain.add.completed',
      eventStatus: 'success',
      correlationId,
      idempotencyKey,
      payload: { response: responsePayload },
    });

    metricDomain('domain_add_success', 1, { tenantId: params.id, status });
    logDomain('info', 'domain.add.completed', {
      tenantId: params.id,
      domain,
      status,
      correlationId,
    });
    return NextResponse.json({ correlationId, ...responsePayload }, { status: 201 });
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number' ? error.status : 502;
    const code = typeof error?.code === 'string' ? error.code : 'ERR_VERCEL_DOMAIN_ADD_FAILED';
    const message = typeof error?.message === 'string' ? error.message : 'Failed to add domain on Vercel';
    const retryable = Boolean(error?.retryable);

    await supabaseAdmin
      .from('tenant_domains')
      .update({
        status: code === 'ERR_DOMAIN_CONFLICT' ? 'conflict' : 'error',
        last_error_code: code,
        last_error_message: message,
        updated_by: auth.data.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', insertedDomain.data.id);

    await supabaseAdmin.from('tenant_domain_dlq').insert({
      tenant_id: params.id,
      tenant_domain_id: insertedDomain.data.id,
      operation: 'add_domain',
      domain,
      attempts: 1,
      last_error_code: code,
      last_error_message: message,
      payload: { correlationId, retryable },
      next_retry_at: retryable ? new Date(Date.now() + 60_000).toISOString() : null,
    });

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: insertedDomain.data.id,
      actorUserId: auth.data.user.id,
      eventName: 'domain.add.completed',
      eventStatus: 'error',
      correlationId,
      idempotencyKey,
      payload: { code, message, retryable },
    });

    metricDomain('domain_add_error', 1, { tenantId: params.id, code });
    logDomain('error', 'domain.add.failed', {
      tenantId: params.id,
      domain,
      code,
      correlationId,
      retryable,
    });
    return NextResponse.json({ error: message, code, correlationId }, { status: statusCode });
  }
}
