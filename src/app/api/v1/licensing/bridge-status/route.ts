import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  getAppInstallationById,
  listAppInstallations,
  parsePlanCode,
  resolveCheckoutSource,
  resolveCorrelationId,
  type BillingState,
} from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const correlationId = resolveCorrelationId(
    searchParams.get('correlation_id') || req.headers.get('x-correlation-id')
  );
  const source = resolveCheckoutSource(searchParams.get('source') || req.headers.get('x-checkout-source'));

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const planCode = parsePlanCode(searchParams.get('plan'));
  if (!planCode) {
    return NextResponse.json(
      { error: 'Invalid or unsupported plan', code: 'ERR_PLAN_INVALID', correlationId },
      { status: 400 }
    );
  }
  const eventKey = `${auth.data.user.id}:${planCode}:${correlationId}`;

  const installUrl =
    process.env.GITHUB_APP_INSTALL_URL || 'https://github.com/apps/jsonpages-cloud-sync/installations/new';
  const configureUrl = process.env.GITHUB_APP_CONFIGURE_URL || 'https://github.com/settings/installations';
  const requestedInstallationIdRaw = searchParams.get('installation_id');
  const tenantIdRaw = searchParams.get('tenant_id')?.trim() ?? null;
  if (tenantIdRaw && !isUuid(tenantIdRaw)) {
    return NextResponse.json(
      { error: 'Invalid tenant_id', code: 'ERR_TENANT_ID_INVALID', correlationId },
      { status: 400 }
    );
  }
  const requestedInstallationIdParsed = requestedInstallationIdRaw ? Number(requestedInstallationIdRaw) : null;
  if (
    requestedInstallationIdRaw &&
    (requestedInstallationIdParsed === null ||
      !Number.isInteger(requestedInstallationIdParsed) ||
      requestedInstallationIdParsed <= 0)
  ) {
    return NextResponse.json(
      { error: 'Invalid installation_id', code: 'ERR_INSTALLATION_ID_INVALID', correlationId },
      { status: 400 }
    );
  }
  const requestedInstallationId = requestedInstallationIdRaw ? requestedInstallationIdParsed : null;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    let existingIntent: { installation_id: number | null } | null = null;
    if (tenantIdRaw) {
      const { data } = await supabaseAdmin
        .from('billing_intents')
        .select('installation_id')
        .eq('user_id', auth.data.user.id)
        .eq('tenant_id', tenantIdRaw)
        .eq('plan_code', planCode)
        .maybeSingle();
      existingIntent = data;
    }

    const selectedInstallationId = requestedInstallationId ?? existingIntent?.installation_id ?? null;
    let selectedInstallation = selectedInstallationId
      ? await getAppInstallationById(selectedInstallationId)
      : null;
    let selectionMode: 'installation_id' | 'github_login' | 'none' = selectedInstallation ? 'installation_id' : 'none';
    const staleInstallationId = selectedInstallationId && !selectedInstallation ? selectedInstallationId : null;

    if (!selectedInstallation && auth.data.githubLogin) {
      const githubLogin = auth.data.githubLogin.trim().toLowerCase();
      if (githubLogin) {
        const appInstallations = await listAppInstallations();
        selectedInstallation =
          appInstallations.find((inst) => inst.accountLogin.trim().toLowerCase() === githubLogin) ?? null;
        if (selectedInstallation) selectionMode = 'github_login';
      }
    }

    if (staleInstallationId && !selectedInstallation) {
      console.info('[licensing.bridge-status]', {
        correlationId,
        eventKey,
        userId: auth.data.user.id,
        planCode,
        requestedInstallationId: requestedInstallationId ?? null,
        staleInstallationId,
        fallback: 'bridge_missing',
      });
    }

    const state: BillingState = selectedInstallation ? 'bridge_ready' : 'bridge_missing';
    if (tenantIdRaw) {
      const updatePayload = {
        user_id: auth.data.user.id,
        tenant_id: tenantIdRaw,
        plan_code: planCode,
        state,
        installation_id: selectedInstallation?.id ?? null,
        installation_owner_login: selectedInstallation?.accountLogin ?? null,
        correlation_id: correlationId,
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
        metadata: {
          githubLogin: auth.data.githubLogin,
          selectedInstallationId,
          resolvedInstallationId: selectedInstallation?.id ?? null,
          staleInstallationId,
          selectionMode,
          decisionPath: state,
          source,
        },
      };

      const { error: upsertError } = await supabaseAdmin
        .from('billing_intents')
        .upsert(updatePayload, { onConflict: 'tenant_id,plan_code' });

      if (upsertError) {
        return NextResponse.json(
          { error: 'Failed to persist bridge state', code: 'ERR_BILLING_STATE_PERSIST_FAILED', correlationId },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      correlationId,
      state,
      source,
      githubLogin: auth.data.githubLogin,
      tenantId: tenantIdRaw,
      selectedInstallationId: selectedInstallation?.id ?? null,
      staleInstallationId,
      installUrl,
      configureUrl,
    });
  } catch (error: any) {
    const isAppConfigMissing = typeof error?.message === 'string' && error.message.includes('not configured');
    const errorCode = isAppConfigMissing
      ? 'ERR_GITHUB_APP_CONFIG_MISSING'
      : 'ERR_GITHUB_APP_INSTALLATION_FETCH_FAILED';

    console.error('[licensing.bridge-status]', {
      correlationId,
      userId: auth.data.user.id,
      planCode,
      requestedInstallationId: requestedInstallationId ?? null,
      code: errorCode,
      message: error?.message ?? 'Unknown error',
    });

    return NextResponse.json(
      {
        error: error?.message || 'Failed to resolve bridge status',
        code: errorCode,
        correlationId,
      },
      { status: 500 }
    );
  }
}
