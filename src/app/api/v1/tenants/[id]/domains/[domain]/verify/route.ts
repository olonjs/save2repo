import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireRequestUser, assertTenantAccess } from '@/lib/serverAuth';
import { appendDomainEvent, assertDomainGovernance, extractVerificationTargets, normalizeDomain, resolveCorrelationId } from '@/lib/customDomains';
import { vercelGetDomainConfig, vercelGetDomainStatus, vercelVerifyDomain } from '@/lib/vercelDomains';
import { getOwnerVercelCreds, OwnerVercelCredsMissingError } from '@/lib/ownerVercelCreds';
import { logDomain, metricDomain } from '@/lib/domainTelemetry';
import { deriveDomainStatusFromVercel } from '@/lib/domainStatus';

export const dynamic = 'force-dynamic';

export async function POST(
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

  const governance = await assertDomainGovernance({ userId: auth.data.user.id, tenantId: params.id });
  if (!governance.ok) {
    return NextResponse.json({ error: governance.error, code: governance.code, correlationId }, { status: governance.status });
  }

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const supabaseAdmin = getSupabaseAdmin();
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
  if (!access.data.tenant.vercel_project_id) {
    return NextResponse.json(
      { error: 'Tenant has no Vercel project configured', code: 'ERR_VERCEL_PROJECT_MISSING', correlationId },
      { status: 409 }
    );
  }

  let vercelCreds;
  try {
    vercelCreds = await getOwnerVercelCreds(auth.data.user.id);
  } catch (err) {
    if (err instanceof OwnerVercelCredsMissingError) {
      return NextResponse.json({ error: err.message, code: err.code, correlationId }, { status: 409 });
    }
    throw err;
  }

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: row.id,
    actorUserId: auth.data.user.id,
    eventName: 'domain.verify.requested',
    eventStatus: 'pending',
    correlationId,
    payload: { domain },
  });

  try {
    const verifyPayload = await vercelVerifyDomain(vercelCreds, access.data.tenant.vercel_project_id, domain);
    const statusPayload = await vercelGetDomainStatus(vercelCreds, access.data.tenant.vercel_project_id, domain);
    const configPayload = await vercelGetDomainConfig(vercelCreds, access.data.tenant.vercel_project_id, domain).catch(() => null);
    const mergedPayload = { ...statusPayload, verifyPayload, config: configPayload };
    const verificationTargets = extractVerificationTargets({
      domain,
      verificationPayload: mergedPayload,
    });
    const status = deriveDomainStatusFromVercel(mergedPayload, verificationTargets.checks.length).status;
    const updatedAt = new Date().toISOString();
    const verifiedAt = status === 'active' ? updatedAt : null;

    await supabaseAdmin
      .from('tenant_domains')
      .update({
        status,
        verification_targets: verificationTargets,
        verified_at: verifiedAt,
        last_vercel_payload: mergedPayload,
        last_error_code: null,
        last_error_message: null,
        updated_by: auth.data.user.id,
        updated_at: updatedAt,
      })
      .eq('id', row.id);

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: row.id,
      actorUserId: auth.data.user.id,
      eventName: 'domain.verify.completed',
      eventStatus: 'success',
      correlationId,
      payload: { domain, status },
    });

    metricDomain('domain_verify_success', 1, { tenantId: params.id, status });
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
    const code = typeof error?.code === 'string' ? error.code : 'ERR_DOMAIN_VERIFY_FAILED';
    const message = typeof error?.message === 'string' ? error.message : 'Failed to verify domain on Vercel';
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
      operation: 'verify_domain',
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
      eventName: 'domain.verify.completed',
      eventStatus: 'error',
      correlationId,
      payload: { code, message, retryable },
    });

    metricDomain('domain_verify_error', 1, { tenantId: params.id, code });
    logDomain('warn', 'domain.verify.failed', { tenantId: params.id, domain, code, correlationId, retryable });
    return NextResponse.json({ error: message, code, correlationId }, { status: statusCode });
  }
}
