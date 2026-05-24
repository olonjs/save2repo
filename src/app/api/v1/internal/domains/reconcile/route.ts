import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { vercelGetDomainConfig, vercelGetDomainStatus, vercelVerifyDomain } from '@/lib/vercelDomains';
import { requireDomainsAdmin } from '@/lib/internalAdmin';
import { extractVerificationTargets } from '@/lib/customDomains';
import { deriveDomainStatusFromVercel } from '@/lib/domainStatus';
import { getZone, type CloudflareApiError } from '@/lib/cloudflareApi';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_DOMAINS_CRON_SECRET;
  const cronAuthorized = !!secret && req.headers.get('x-cron-secret') === secret;
  if (!cronAuthorized) {
    const admin = await requireDomainsAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error, code: admin.code }, { status: admin.status });
    }
  }

  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get('limit') ?? 50)));
  const supabaseAdmin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('tenant_domains')
    .select('id, tenant_id, domain, status, tenants:tenant_id(vercel_project_id)')
    .in('status', ['pending_dns', 'verifying'])
    .lt('updated_at', cutoff)
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load domains to reconcile', code: 'ERR_DOMAIN_RECONCILE_LOAD_FAILED' },
      { status: 500 }
    );
  }

  let updated = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const projectId = (row as any)?.tenants?.vercel_project_id as string | null;
    if (!projectId) {
      failed += 1;
      continue;
    }
    try {
      let statusPayload = await vercelGetDomainStatus(projectId, row.domain);
      if (!statusPayload?.verified) {
        const verifyPayload = await vercelVerifyDomain(projectId, row.domain).catch(() => null);
        statusPayload = { ...statusPayload, verifyPayload };
      }
      const configPayload = await vercelGetDomainConfig(projectId, row.domain).catch(() => null);
      const providerPayload = { ...statusPayload, config: configPayload };
      const verificationTargets = extractVerificationTargets({
        domain: row.domain,
        verificationPayload: providerPayload,
      });

      const status = deriveDomainStatusFromVercel(providerPayload, verificationTargets.checks.length).status;
      await supabaseAdmin
        .from('tenant_domains')
        .update({
          status,
          verification_targets: verificationTargets,
          verified_at: status === 'active' ? new Date().toISOString() : null,
          last_vercel_payload: providerPayload,
          last_error_code: null,
          last_error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      updated += 1;
    } catch (reconcileError: any) {
      failed += 1;
      const code = typeof reconcileError?.code === 'string' ? reconcileError.code : 'ERR_DOMAIN_RECONCILE_FAILED';
      const message =
        typeof reconcileError?.message === 'string'
          ? reconcileError.message
          : 'Failed to reconcile domain with Vercel';

      await supabaseAdmin
        .from('tenant_domains')
        .update({
          last_error_code: code,
          last_error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      await supabaseAdmin.from('tenant_domain_dlq').insert({
        tenant_id: row.tenant_id,
        tenant_domain_id: row.id,
        operation: 'reconcile',
        domain: row.domain,
        attempts: 1,
        last_error_code: code,
        last_error_message: message,
        payload: { retryable: Boolean(reconcileError?.retryable) },
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    }
  }

  // --- Cloudflare zone reconcile: pending_ns -> active ---
  const cfCutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: cfRows, error: cfError } = await supabaseAdmin
    .from('tenant_domains')
    .select('id, tenant_id, domain, cf_zone_id, cf_attached_at')
    .eq('cf_status', 'pending_ns')
    .not('cf_zone_id', 'is', null)
    .or(`cf_zone_status_checked_at.is.null,cf_zone_status_checked_at.lt.${cfCutoff}`)
    .is('deleted_at', null)
    .order('cf_zone_status_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  let cfProcessed = 0;
  let cfUpdated = 0;
  let cfFailed = 0;

  if (!cfError) {
    for (const row of cfRows ?? []) {
      cfProcessed += 1;
      const zoneId = row.cf_zone_id as string;
      try {
        const zone = await getZone(zoneId);
        const isActive = zone.status === 'active';
        await supabaseAdmin
          .from('tenant_domains')
          .update({
            cf_status: isActive ? 'active' : 'pending_ns',
            cf_zone_status_checked_at: new Date().toISOString(),
            cf_attached_at: isActive && !row.cf_attached_at ? new Date().toISOString() : row.cf_attached_at,
            cf_nameservers: zone.name_servers ?? undefined,
            cf_last_error_code: null,
            cf_last_error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        await supabaseAdmin.from('tenant_domain_events').insert({
          tenant_id: row.tenant_id,
          tenant_domain_id: row.id,
          event_name: isActive ? 'cf_reconcile.activated' : 'cf_reconcile.pending',
          event_status: 'success',
          payload: { zone_id: zoneId, cf_zone_status: zone.status },
        });

        if (isActive) cfUpdated += 1;
      } catch (cfReconcileError: unknown) {
        cfFailed += 1;
        const cfErr = (typeof cfReconcileError === 'object' && cfReconcileError !== null
          ? (cfReconcileError as Partial<CloudflareApiError>)
          : {}) as Partial<CloudflareApiError>;
        const code = typeof cfErr.code === 'string' ? cfErr.code : 'ERR_CF_RECONCILE_FAILED';
        const message = typeof cfErr.message === 'string' ? cfErr.message : 'Failed to reconcile CF zone';

        await supabaseAdmin
          .from('tenant_domains')
          .update({
            cf_zone_status_checked_at: new Date().toISOString(),
            cf_last_error_code: code,
            cf_last_error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        await supabaseAdmin.from('tenant_domain_dlq').insert({
          tenant_id: row.tenant_id,
          tenant_domain_id: row.id,
          operation: 'cf_reconcile',
          domain: row.domain,
          attempts: 1,
          last_error_code: code,
          last_error_message: message,
          payload: { retryable: Boolean(cfErr.retryable) },
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: (rows ?? []).length,
    updated,
    failed,
    cf: {
      processed: cfProcessed,
      updated: cfUpdated,
      failed: cfFailed,
    },
  });
}
