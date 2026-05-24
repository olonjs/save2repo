import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parsePlanCode, resolveCheckoutSource, resolveCorrelationId, resolveVariantIdByPlan } from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';
const DEFAULT_CHECKOUT_REUSE_MAX_AGE_MS = 15 * 60 * 1000;
const FALLBACK_RECOVERABLE_STATES = new Set([
  'checkout_created',
  'payment_pending',
  'licensed_ready',
  'licensed_ready_assigned',
  'licensed_ready_unassigned',
]);

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveCheckoutReuseMaxAgeMs(): number {
  const raw = Number(process.env.LS_CHECKOUT_REUSE_MAX_AGE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHECKOUT_REUSE_MAX_AGE_MS;
  return Math.floor(raw);
}

function isSafeCheckoutUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('lemonsqueezy.com');
  } catch {
    return false;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const correlationId = resolveCorrelationId(
    searchParams.get('correlation_id') || req.headers.get('x-correlation-id')
  );
  const source = resolveCheckoutSource(searchParams.get('source') || req.headers.get('x-checkout-source'));
  const runtimeHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || null;
  const vercelEnv = process.env.VERCEL_ENV ?? 'unknown';

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const planCode = parsePlanCode(searchParams.get('plan'));
  const tenantIdParam = searchParams.get('tenant_id')?.trim() ?? null;
  const correlationIdParam = searchParams.get('correlation_id')?.trim() ?? null;
  if (!planCode) {
    return NextResponse.json(
      { error: 'Invalid or unsupported plan', code: 'ERR_PLAN_INVALID', correlationId },
      { status: 400 }
    );
  }
  if (tenantIdParam && !isUuid(tenantIdParam)) {
    return NextResponse.json(
      { error: 'Invalid tenant_id', code: 'ERR_TENANT_ID_INVALID', correlationId },
      { status: 400 }
    );
  }
  const eventKey = `${auth.data.user.id}:${planCode}:${correlationId}`;

  const supabaseAdmin = getSupabaseAdmin();
  let data: any = null;
  let error: any = null;
  let resolvedViaFallback = false;

  // 1) Se stiamo lavorando su uno specifico tenant, preferire una licenza già attiva per quel tenant+plan.
  const licensedStates = ['licensed_ready', 'licensed_ready_assigned', 'licensed_ready_unassigned'];
  if (tenantIdParam) {
    const { data: licensed, error: licensedError } = await supabaseAdmin
      .from('billing_intents')
      .select(
        'tenant_id, state, correlation_id, checkout_id, checkout_url, installation_id, ls_variant_id, ls_store_id, updated_at, last_error_code, last_error_message'
        + ', metadata'
      )
      .eq('tenant_id', tenantIdParam)
      .eq('plan_code', planCode)
      .eq('user_id', auth.data.user.id)
      .in('state', licensedStates)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (licensedError) {
      return NextResponse.json(
        { error: 'Failed to load licensed state', code: 'ERR_CHECKOUT_STATUS_LICENSED_READ_FAILED', correlationId },
        { status: 500 }
      );
    }

    if (licensed) {
      data = licensed;
    }
  }
  // 2) Se non esiste una licenza attiva per il tenant (o non è specificato un tenant),
  //    si applica la logica corrente sui checkout pendenti.
  if (!data && tenantIdParam) {
    const res = await supabaseAdmin
      .from('billing_intents')
      .select(
        'tenant_id, state, correlation_id, checkout_id, checkout_url, installation_id, ls_variant_id, ls_store_id, updated_at, last_error_code, last_error_message'
        + ', metadata'
      )
      .eq('tenant_id', tenantIdParam)
      .eq('plan_code', planCode)
      .eq('user_id', auth.data.user.id)
      .maybeSingle();
    data = res.data;
    error = res.error;
  } else if (!data && correlationIdParam) {
    const res = await supabaseAdmin
      .from('billing_intents')
      .select(
        'tenant_id, state, correlation_id, checkout_id, checkout_url, installation_id, ls_variant_id, ls_store_id, updated_at, last_error_code, last_error_message'
        + ', metadata'
      )
      .eq('user_id', auth.data.user.id)
      .eq('plan_code', planCode)
      .eq('correlation_id', correlationIdParam)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = res.data;
    error = res.error;
  } else if (!data) {
    const res = await supabaseAdmin
      .from('billing_intents')
      .select(
        'tenant_id, state, correlation_id, checkout_id, checkout_url, installation_id, ls_variant_id, ls_store_id, updated_at, last_error_code, last_error_message'
        + ', metadata'
      )
      .eq('user_id', auth.data.user.id)
      .eq('plan_code', planCode)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = res.data;
    error = res.error;
  }

  if (!data && error) {
    return NextResponse.json(
      { error: 'Failed to load checkout status', code: 'ERR_CHECKOUT_STATUS_READ_FAILED', correlationId },
      { status: 500 }
    );
  }

  if (!data && correlationIdParam) {
    let fallbackQuery = supabaseAdmin
      .from('billing_intents')
      .select(
        'tenant_id, state, correlation_id, checkout_id, checkout_url, installation_id, ls_variant_id, ls_store_id, updated_at, last_error_code, last_error_message'
        + ', metadata'
      )
      .eq('user_id', auth.data.user.id)
      .eq('plan_code', planCode)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (tenantIdParam) {
      fallbackQuery = fallbackQuery.eq('tenant_id', tenantIdParam);
    } else {
      fallbackQuery = fallbackQuery.is('tenant_id', null);
    }

    const fallback = await fallbackQuery.maybeSingle();
    if (fallback.error) {
      return NextResponse.json(
        { error: 'Failed to load checkout status fallback', code: 'ERR_CHECKOUT_STATUS_FALLBACK_READ_FAILED', correlationId },
        { status: 500 }
      );
    }

    const fallbackRow = (fallback.data ?? null) as any;
    if (fallbackRow && FALLBACK_RECOVERABLE_STATES.has(String(fallbackRow.state ?? ''))) {
      data = fallbackRow;
      resolvedViaFallback = true;
      console.info('[licensing.checkout-status.fallback]', {
        correlationId,
        eventKey,
        userId: auth.data.user.id,
        planCode,
        tenantId: tenantIdParam,
        requestedCorrelationId: correlationIdParam,
        resolvedCorrelationId: fallbackRow.correlation_id ?? null,
        state: fallbackRow.state ?? null,
      });
    }
  }

  if (!data) {
    return NextResponse.json({
      correlationId,
      state: 'authenticated',
      checkoutId: null,
      checkoutUrl: null,
      installationId: null,
      tenantId: tenantIdParam,
      source,
      variantId: null,
    });
  }

  const normalizedState =
    data.state === 'licensed_ready'
      ? data.tenant_id
        ? 'licensed_ready_assigned'
        : 'licensed_ready_unassigned'
      : data.state;

  const storeId = process.env.LS_STORE_ID?.trim() ?? '';
  const variantId = resolveVariantIdByPlan(planCode);
  const updatedAt = parseIsoDate(data.updated_at);
  const ageMs = updatedAt ? Date.now() - updatedAt.getTime() : Number.POSITIVE_INFINITY;
  const maxAgeMs = resolveCheckoutReuseMaxAgeMs();
  const isFreshEnough = Number.isFinite(ageMs) && ageMs <= maxAgeMs;
  const matchesContext =
    !!data.ls_store_id &&
    !!data.ls_variant_id &&
    data.ls_store_id === storeId &&
    data.ls_variant_id === variantId;
  const isPendingState = normalizedState === 'checkout_created' || normalizedState === 'payment_pending';
  const checkoutRecoveryReasons = {
    missingCheckoutUrl: !data.checkout_url,
    invalidCheckoutUrl: !!data.checkout_url && !isSafeCheckoutUrl(data.checkout_url),
    stateNotReusable: !isPendingState,
    staleCheckout: !isFreshEnough,
    variantMismatch: !!data.ls_variant_id && data.ls_variant_id !== variantId,
    storeMismatch: !!data.ls_store_id && data.ls_store_id !== storeId,
    missingCheckoutContext: !data.ls_variant_id || !data.ls_store_id,
  };
  const checkoutReusable = isPendingState && isSafeCheckoutUrl(data.checkout_url) && isFreshEnough && matchesContext;
  const checkoutRecoveryRequired = isPendingState && !checkoutReusable;
  const effectiveState = checkoutRecoveryRequired ? 'bridge_ready' : normalizedState;
  const effectiveCheckoutId = checkoutReusable ? data.checkout_id : null;

  if (checkoutRecoveryRequired) {
    console.info('[licensing.checkout-status]', {
      correlationId,
      eventKey,
      userId: auth.data.user.id,
      planCode,
      tenantId: data.tenant_id ?? tenantIdParam,
      checkoutReusable,
      checkoutRecoveryRequired,
      checkoutRecoveryReasons,
      checkoutAgeMs: Number.isFinite(ageMs) ? ageMs : null,
      runtimeHost,
      vercelEnv,
      state: data.state,
      checkoutId: data.checkout_id,
      existingVariantId: data.ls_variant_id,
      existingStoreId: data.ls_store_id,
      expectedVariantId: variantId,
      expectedStoreId: storeId,
    });
  }

  return NextResponse.json({
    correlationId: data.correlation_id ?? correlationId,
    state: effectiveState,
    originalState: data.state,
    normalizedState,
    checkoutId: effectiveCheckoutId,
    checkoutUrl: checkoutReusable ? data.checkout_url : null,
    installationId: data.installation_id,
    tenantId: data.tenant_id,
    variantId: data.ls_variant_id,
    storeId: data.ls_store_id,
    source: data.metadata?.source ?? source,
    updatedAt: data.updated_at,
    checkoutReusable,
    checkoutRecoveryRequired,
    checkoutRecoveryReasons,
    resolvedViaFallback,
    lastErrorCode: data.last_error_code,
    lastErrorMessage: data.last_error_message,
  });
}
