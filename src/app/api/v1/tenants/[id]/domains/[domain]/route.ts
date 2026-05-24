import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireRequestUser, assertTenantAccess } from '@/lib/serverAuth';
import {
  appendDomainEvent,
  assertDomainGovernance,
  enforceDomainMutationRateLimit,
  extractVerificationTargets,
  normalizeDomain,
  resolveCorrelationId,
} from '@/lib/customDomains';
import { vercelGetDomainConfig, vercelGetDomainStatus, vercelRemoveDomain, vercelVerifyDomain } from '@/lib/vercelDomains';
import { logDomain, metricDomain } from '@/lib/domainTelemetry';
import { deriveDomainStatusFromVercel } from '@/lib/domainStatus';

export const dynamic = 'force-dynamic';

function resolveDomainParam(rawDomain: string): string {
  return normalizeDomain(decodeURIComponent(rawDomain));
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string }> }
) {
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

  const domain = resolveDomainParam(params.domain);
  const supabaseAdmin = getSupabaseAdmin();
  const { data: row } = await supabaseAdmin
    .from('tenant_domains')
    .select(
      'id, domain, status, verification_targets, last_error_code, last_error_message, verified_at, created_at, updated_at, cf_zone_id, cf_nameservers, cf_status, cf_attached_at, cf_last_error_code, cf_last_error_message'
    )
    .eq('tenant_id', params.id)
    .eq('domain', domain)
    .is('deleted_at', null)
    .maybeSingle();

  if (!row?.id) {
    return NextResponse.json(
      { error: 'Domain not found for tenant', code: 'ERR_DOMAIN_NOT_FOUND', correlationId },
      { status: 404 }
    );
  }

  if (!access.data.tenant.vercel_project_id) {
    return NextResponse.json(
      { error: 'Tenant has no Vercel project configured', code: 'ERR_VERCEL_PROJECT_MISSING', correlationId },
      { status: 409 }
    );
  }

  const shouldVerify = req.nextUrl.searchParams.get('verify') !== '0';

  try {
    let vercelStatus = await vercelGetDomainStatus(access.data.tenant.vercel_project_id, domain);
    if (shouldVerify && !vercelStatus?.verified) {
      await appendDomainEvent({
        tenantId: params.id,
        tenantDomainId: row.id,
        actorUserId: auth.data.user.id,
        eventName: 'domain.verify.requested',
        eventStatus: 'pending',
        correlationId,
        payload: { domain },
      });
      const verifyResponse = await vercelVerifyDomain(access.data.tenant.vercel_project_id, domain);
      vercelStatus = { ...vercelStatus, verifyResponse };
    }

    const vercelConfig = await vercelGetDomainConfig(access.data.tenant.vercel_project_id, domain).catch(() => null);
    const providerPayload = { ...vercelStatus, config: vercelConfig };
    const verificationTargets = extractVerificationTargets({
      domain,
      verificationPayload: providerPayload,
    });
    const status = deriveDomainStatusFromVercel(providerPayload, verificationTargets.checks.length).status;
    const updatedAt = new Date().toISOString();
    const verifiedAt = status === 'active' ? updatedAt : row.verified_at;
    await supabaseAdmin
      .from('tenant_domains')
      .update({
        status,
        verification_targets: verificationTargets,
        verified_at: verifiedAt,
        last_error_code: null,
        last_error_message: null,
        last_vercel_payload: providerPayload,
        updated_by: auth.data.user.id,
        updated_at: updatedAt,
      })
      .eq('id', row.id);

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: row.id,
      actorUserId: auth.data.user.id,
      eventName: 'domain.status.refreshed',
      eventStatus: 'success',
      correlationId,
      payload: { domain, status },
    });

    metricDomain('domain_status_refresh_success', 1, { tenantId: params.id, status });
    return NextResponse.json({
      correlationId,
      tenantId: params.id,
      domain: {
        id: row.id,
        domain,
        status,
        verification_targets: verificationTargets,
        updated_at: updatedAt,
        verified_at: verifiedAt,
      },
    });
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number' ? error.status : 502;
    const code = typeof error?.code === 'string' ? error.code : 'ERR_DOMAIN_STATUS_FAILED';
    const message = typeof error?.message === 'string' ? error.message : 'Failed to fetch domain status';
    const retryable = Boolean(error?.retryable);

    await supabaseAdmin
      .from('tenant_domains')
      .update({
        status: code === 'ERR_DOMAIN_CONFLICT' ? 'conflict' : row.status,
        last_error_code: code,
        last_error_message: message,
        updated_by: auth.data.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    await supabaseAdmin.from('tenant_domain_dlq').insert({
      tenant_id: params.id,
      tenant_domain_id: row.id,
      operation: 'status_or_verify',
      domain,
      attempts: 1,
      last_error_code: code,
      last_error_message: message,
      payload: { correlationId, retryable },
      next_retry_at: retryable ? new Date(Date.now() + 60_000).toISOString() : null,
    });

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: row.id,
      actorUserId: auth.data.user.id,
      eventName: 'domain.status.refreshed',
      eventStatus: 'error',
      correlationId,
      payload: { code, message, retryable },
    });

    metricDomain('domain_status_refresh_error', 1, { tenantId: params.id, code });
    logDomain('warn', 'domain.status.failed', { tenantId: params.id, domain, code, correlationId, retryable });
    return NextResponse.json({ error: message, code, correlationId }, { status: statusCode });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string }> }
) {
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

  const mutationLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.data.user.id });
  if (!mutationLimit.ok) {
    return NextResponse.json(
      { error: mutationLimit.error, code: mutationLimit.code, correlationId },
      { status: mutationLimit.status }
    );
  }

  const domain = resolveDomainParam(params.domain);
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? null;
  const supabaseAdmin = getSupabaseAdmin();

  if (idempotencyKey) {
    const previous = await supabaseAdmin
      .from('tenant_domain_events')
      .select('payload')
      .eq('tenant_id', params.id)
      .eq('actor_user_id', auth.data.user.id)
      .eq('event_name', 'domain.remove.completed')
      .eq('idempotency_key', idempotencyKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousResponse = previous.data?.payload?.response;
    if (previousResponse && typeof previousResponse === 'object') {
      return NextResponse.json({ correlationId, idempotentReplay: true, ...previousResponse });
    }
  }

  const { data: row } = await supabaseAdmin
    .from('tenant_domains')
    .select('id, status')
    .eq('tenant_id', params.id)
    .eq('domain', domain)
    .is('deleted_at', null)
    .maybeSingle();
  if (!row?.id) {
    return NextResponse.json(
      { error: 'Domain not found for tenant', code: 'ERR_DOMAIN_NOT_FOUND', correlationId },
      { status: 404 }
    );
  }

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: row.id,
    actorUserId: auth.data.user.id,
    eventName: 'domain.remove.requested',
    eventStatus: 'pending',
    correlationId,
    idempotencyKey,
    payload: { domain },
  });

  try {
    if (access.data.tenant.vercel_project_id) {
      await vercelRemoveDomain(access.data.tenant.vercel_project_id, domain);
    }
  } catch (error: any) {
    const isNotFound = typeof error?.status === 'number' && error.status === 404;
    if (!isNotFound) {
      const code = typeof error?.code === 'string' ? error.code : 'ERR_DOMAIN_REMOVE_FAILED';
      const message = typeof error?.message === 'string' ? error.message : 'Failed to remove domain on Vercel';
      const retryable = Boolean(error?.retryable);

      await supabaseAdmin.from('tenant_domain_dlq').insert({
        tenant_id: params.id,
        tenant_domain_id: row.id,
        operation: 'remove_domain',
        domain,
        attempts: 1,
        last_error_code: code,
        last_error_message: message,
        payload: { correlationId, retryable },
        next_retry_at: retryable ? new Date(Date.now() + 60_000).toISOString() : null,
      });

      await appendDomainEvent({
        tenantId: params.id,
        tenantDomainId: row.id,
        actorUserId: auth.data.user.id,
        eventName: 'domain.remove.completed',
        eventStatus: 'error',
        correlationId,
        idempotencyKey,
        payload: { code, message, retryable },
      });

      metricDomain('domain_remove_error', 1, { tenantId: params.id, code });
      logDomain('warn', 'domain.remove.failed', { tenantId: params.id, domain, code, correlationId, retryable });
      return NextResponse.json({ error: message, code, correlationId }, { status: error?.status ?? 502 });
    }
  }

  await supabaseAdmin
    .from('tenant_domains')
    .update({
      status: 'deleted',
      deleted_at: new Date().toISOString(),
      updated_by: auth.data.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  const responsePayload = {
    tenantId: params.id,
    domain: {
      id: row.id,
      domain,
      status: 'deleted',
    },
  };

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: row.id,
    actorUserId: auth.data.user.id,
    eventName: 'domain.remove.completed',
    eventStatus: 'success',
    correlationId,
    idempotencyKey,
    payload: { response: responsePayload },
  });

  metricDomain('domain_remove_success', 1, { tenantId: params.id });
  return NextResponse.json({ correlationId, ...responsePayload });
}
