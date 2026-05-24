import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parsePlanCode, resolveCorrelationId } from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

type BillingStatus = 'active' | 'past_due' | 'unknown';

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeBillingStatus(subscriptionStatus: string | null, intentState: string | null): BillingStatus {
  const normalizedSubscriptionStatus = subscriptionStatus?.trim().toLowerCase() ?? null;
  if (normalizedSubscriptionStatus) {
    if (['active', 'on_trial', 'trialing', 'paid'].includes(normalizedSubscriptionStatus)) return 'active';
    if (['past_due', 'unpaid', 'overdue', 'paused'].includes(normalizedSubscriptionStatus)) return 'past_due';
  }

  if (
    intentState === 'licensed_ready' ||
    intentState === 'licensed_ready_assigned' ||
    intentState === 'licensed_ready_unassigned'
  ) {
    return 'active';
  }

  return 'unknown';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const correlationId = resolveCorrelationId(
    searchParams.get('correlation_id') || req.headers.get('x-correlation-id')
  );
  const tenantId = searchParams.get('tenant_id')?.trim() ?? null;

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  if (tenantId && !isUuid(tenantId)) {
    return NextResponse.json(
      { error: 'Invalid tenant_id', code: 'ERR_TENANT_ID_INVALID', correlationId },
      { status: 400 }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  if (tenantId) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .eq('owner_id', auth.data.user.id)
      .maybeSingle();
    if (!tenant?.id) {
      return NextResponse.json(
        { error: 'Tenant not found for current user', code: 'ERR_TENANT_NOT_FOUND', correlationId },
        { status: 404 }
      );
    }
  }

  const licensedStates = ['licensed_ready', 'licensed_ready_assigned', 'licensed_ready_unassigned'];
  let intent: any = null;

  if (tenantId) {
    const tenantScoped = await supabaseAdmin
      .from('billing_intents')
      .select(
        'plan_code, state, updated_at, ls_customer_id, ls_subscription_status, ls_subscription_renews_at, ls_portal_url'
      )
      .eq('user_id', auth.data.user.id)
      .eq('tenant_id', tenantId)
      .in('state', licensedStates)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    intent = tenantScoped.data ?? null;
  }

  if (!intent) {
    const userScoped = await supabaseAdmin
      .from('billing_intents')
      .select(
        'plan_code, state, updated_at, ls_customer_id, ls_subscription_status, ls_subscription_renews_at, ls_portal_url'
      )
      .eq('user_id', auth.data.user.id)
      .in('state', licensedStates)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    intent = userScoped.data ?? null;
  }

  const { count: entitlementCount, error: entitlementCountError } = await supabaseAdmin
    .from('billing_intents')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', auth.data.user.id)
    .eq('state', 'licensed_ready_unassigned')
    .is('tenant_id', null);

  if (entitlementCountError) {
    return NextResponse.json(
      { error: 'Failed to read entitlement count', code: 'ERR_ENTITLEMENT_COUNT_READ_FAILED', correlationId },
      { status: 500 }
    );
  }

  const planCode = parsePlanCode(intent?.plan_code ?? null);
  const status = normalizeBillingStatus(intent?.ls_subscription_status ?? null, intent?.state ?? null);
  const canManageBilling = Boolean(intent?.ls_customer_id);

  return NextResponse.json({
    correlationId,
    tenantId,
    planCode: planCode ?? null,
    status,
    renewalAt: intent?.ls_subscription_renews_at ?? null,
    currentPeriodEnd: intent?.ls_subscription_renews_at ?? null,
    entitlementCount: entitlementCount ?? 0,
    canManageBilling,
    updatedAt: intent?.updated_at ?? null,
    portalUrl: intent?.ls_portal_url ?? null,
  });
}
