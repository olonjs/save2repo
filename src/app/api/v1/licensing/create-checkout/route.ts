import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  getAppInstallationById,
  getMissingLsEnvKeys,
  resolveCheckoutSource,
  parsePlanCode,
  resolveCorrelationId,
  resolveVariantIdByPlan,
} from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

type CreateCheckoutBody = {
  planCode?: string;
  tenantId?: string | null;
  installationId?: number | string | null;
  forceNew?: boolean;
  source?: string | null;
  correlationId?: string | null;
};

const REUSABLE_CHECKOUT_STATES = new Set(['checkout_created', 'payment_pending']);
const DEFAULT_CHECKOUT_REUSE_MAX_AGE_MS = 15 * 60 * 1000;

function getDashboardReturnUrl(
  planCode: string,
  tenantId?: string | null,
  source?: string | null,
  correlationId?: string | null
): string {
  const query = new URLSearchParams({
    intent: 'subscribe',
    plan: planCode,
  });
  if (tenantId) {
    query.set('tenant_id', tenantId);
  }
  if (source) {
    query.set('source', source);
  }
  if (correlationId) {
    query.set('correlation_id', correlationId);
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && appUrl.trim()) {
    return `${appUrl.replace(/\/$/, '')}/dashboard?${query.toString()}`;
  }
  return `/dashboard?${query.toString()}`;
}

function resolveCheckoutReuseMaxAgeMs(): number {
  const raw = Number(process.env.LS_CHECKOUT_REUSE_MAX_AGE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHECKOUT_REUSE_MAX_AGE_MS;
  return Math.floor(raw);
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidLemonCheckoutUrl(value: string | null | undefined): boolean {
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

async function resolveTenantIdForCheckout(params: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  installationId: number;
  tenantIdRaw: string | null;
}) {
  const { supabaseAdmin, userId, installationId, tenantIdRaw } = params;

  if (tenantIdRaw) {
    if (!isUuid(tenantIdRaw)) {
      return {
        tenantId: null,
        status: 400,
        code: 'ERR_TENANT_ID_INVALID',
        error: 'Invalid tenantId',
      };
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, github_installation_id')
      .eq('id', tenantIdRaw)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!tenant?.id) {
      return {
        tenantId: null,
        status: 404,
        code: 'ERR_TENANT_NOT_FOUND',
        error: 'Tenant not found for current user',
      };
    }

    const tenantInstallationId = Number(tenant.github_installation_id);
    if (Number.isInteger(tenantInstallationId) && tenantInstallationId > 0 && tenantInstallationId !== installationId) {
      return {
        tenantId: null,
        status: 409,
        code: 'ERR_TENANT_INSTALLATION_MISMATCH',
        error: 'Tenant does not match selected installation',
      };
    }

    return { tenantId: tenant.id, status: 200, code: null, error: null };
  }

  return { tenantId: null, status: 200, code: null, error: null };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CreateCheckoutBody;
  const correlationId = resolveCorrelationId(
    typeof body.correlationId === 'string' ? body.correlationId : req.headers.get('x-correlation-id')
  );
  const runtimeHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || null;
  const vercelEnv = process.env.VERCEL_ENV ?? 'unknown';
  const vercelUrl = process.env.VERCEL_URL ?? null;

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.data.error,
        correlationId,
        environmentHint: {
          runtimeHost,
          vercelEnv,
          vercelUrl,
        },
      },
      { status: auth.data.status }
    );
  }

  const planCode = parsePlanCode(body.planCode);
  const source = resolveCheckoutSource(
    typeof body.source === 'string' ? body.source : req.headers.get('x-checkout-source')
  );
  if (!planCode) {
    return NextResponse.json(
      { error: 'Invalid or unsupported plan', code: 'ERR_PLAN_INVALID', correlationId },
      { status: 400 }
    );
  }

  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.json(
      { error: 'Missing or invalid installationId', code: 'ERR_INSTALLATION_ID_INVALID', correlationId },
      { status: 400 }
    );
  }

  const variantId = resolveVariantIdByPlan(planCode);
  const eventKey = `${auth.data.user.id}:${planCode}:${correlationId}`;
  const storeId = process.env.LS_STORE_ID?.trim() ?? '';
  const apiKey = process.env.LS_API_KEY?.trim() ?? '';
  const starterVariantId = process.env.LS_VARIANT_STARTER_ID?.trim() ?? '';
  const proVariantId = process.env.LS_VARIANT_PRO_ID?.trim() ?? '';
  const businessVariantId = process.env.LS_VARIANT_BUSINESS_ID?.trim() ?? '';
  const configPresence = {
    hasLsApiKey: Boolean(apiKey),
    hasLsStoreId: Boolean(storeId),
    hasStarterVariantId: Boolean(starterVariantId),
    hasProVariantId: Boolean(proVariantId),
    hasBusinessVariantId: Boolean(businessVariantId),
  };
  const missingConfig = getMissingLsEnvKeys(planCode);

  if (missingConfig.length > 0 || !variantId) {
    console.error('[licensing.create-checkout]', {
      correlationId,
      eventKey,
      userId: auth.data.user.id,
      code: 'ERR_LS_CONFIG_MISSING',
      planCode,
      missingConfig,
      runtimeHost,
      vercelEnv,
      vercelUrl,
      configPresence,
    });

    return NextResponse.json(
      {
        error: 'LemonSqueezy is not configured',
        code: 'ERR_LS_CONFIG_MISSING',
        correlationId,
        missingConfig,
        environmentHint: {
          runtimeHost,
          vercelEnv,
          vercelUrl,
          configPresence,
        },
      },
      { status: 500 }
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const tenantResolution = await resolveTenantIdForCheckout({
      supabaseAdmin,
      userId: auth.data.user.id,
      installationId,
      tenantIdRaw: typeof body.tenantId === 'string' ? body.tenantId.trim() : null,
    });

    if (tenantResolution.status !== 200) {
      return NextResponse.json(
        { error: tenantResolution.error, code: tenantResolution.code, correlationId },
        { status: tenantResolution.status }
      );
    }
    const tenantId = tenantResolution.tenantId;

    const selectedInstallation = await getAppInstallationById(installationId);
    if (!selectedInstallation) {
      return NextResponse.json(
        { error: 'Installation not found or no longer available', code: 'ERR_INSTALLATION_NOT_FOUND', correlationId },
        { status: 404 }
      );
    }

    if (!body.forceNew) {
      let existingQuery = supabaseAdmin
        .from('billing_intents')
        .select('state, checkout_id, checkout_url, updated_at, ls_variant_id, ls_store_id')
        .eq('plan_code', planCode)
        .eq('user_id', auth.data.user.id);
      if (tenantId) {
        existingQuery = existingQuery.eq('tenant_id', tenantId);
      } else {
        existingQuery = existingQuery.is('tenant_id', null).order('updated_at', { ascending: false }).limit(1);
      }
      const { data: existing } = await existingQuery.maybeSingle();

      const updatedAt = parseIsoDate(existing?.updated_at);
      const checkoutAgeMs = updatedAt ? Date.now() - updatedAt.getTime() : Number.POSITIVE_INFINITY;
      const reuseAgeLimitMs = resolveCheckoutReuseMaxAgeMs();
      const isReusableState = REUSABLE_CHECKOUT_STATES.has(existing?.state ?? '');
      const isFreshEnough = Number.isFinite(checkoutAgeMs) && checkoutAgeMs <= reuseAgeLimitMs;
      const isSameVariant = !!existing?.ls_variant_id && existing.ls_variant_id === variantId;
      const isSameStore = !!existing?.ls_store_id && existing.ls_store_id === storeId;
      const hasSafeCheckoutUrl = isValidLemonCheckoutUrl(existing?.checkout_url);

      if (hasSafeCheckoutUrl && isReusableState && isFreshEnough && isSameVariant && isSameStore) {
        return NextResponse.json({
          correlationId,
          tenantId,
          source,
          state: existing.state,
          checkoutId: existing.checkout_id,
          checkoutUrl: existing.checkout_url,
          reused: true,
          checkoutAgeMs,
        });
      }

      console.info('[licensing.create-checkout]', {
        correlationId,
        eventKey,
        userId: auth.data.user.id,
        tenantId,
        planCode,
        reused: false,
        reason: {
          missingCheckoutUrl: !existing?.checkout_url,
          invalidCheckoutUrl: !!existing?.checkout_url && !hasSafeCheckoutUrl,
          stateNotReusable: !isReusableState,
          staleCheckout: !isFreshEnough,
          variantMismatch: !isSameVariant,
          storeMismatch: !isSameStore,
        },
        checkoutAgeMs: Number.isFinite(checkoutAgeMs) ? checkoutAgeMs : null,
        existingState: existing?.state ?? null,
        existingVariantId: existing?.ls_variant_id ?? null,
        existingStoreId: existing?.ls_store_id ?? null,
      });
    } else {
      console.info('[licensing.create-checkout]', {
        correlationId,
        eventKey,
        userId: auth.data.user.id,
        tenantId,
        planCode,
        reused: false,
        reason: { forcedByClient: true },
      });
    }

    const payload = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            custom: {
              userId: auth.data.user.id,
              ...(tenantId ? { tenantId } : {}),
              githubLogin: auth.data.githubLogin,
              installationId: String(installationId),
              planCode,
              source,
              correlationId,
            },
          },
          ...(process.env.LS_EMBED_DISABLE_REDIRECT === '0'
            ? {
                product_options: {
                  redirect_url: getDashboardReturnUrl(planCode, tenantId, source, correlationId),
                },
              }
            : {}),
          checkout_options: {
            embed: true,
            media: false,
            logo: true,
          },
        },
        relationships: {
          store: {
            data: {
              type: 'stores',
              id: storeId,
            },
          },
          variant: {
            data: {
              type: 'variants',
              id: variantId,
            },
          },
        },
      },
    };

    const lsResponse = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify(payload),
    });

    const lsData = await lsResponse.json().catch(() => ({}));
    if (!lsResponse.ok) {
      const detail = lsData?.errors?.[0]?.detail || 'Checkout creation failed';
      await supabaseAdmin
        .from('billing_intents')
        .upsert(
          {
            user_id: auth.data.user.id,
            tenant_id: tenantId ?? null,
            plan_code: planCode,
            state: 'bridge_ready',
            installation_id: installationId,
            installation_owner_login: selectedInstallation.accountLogin,
            ls_variant_id: variantId,
            ls_store_id: storeId,
            correlation_id: correlationId,
            last_error_code: 'ERR_LS_CHECKOUT_CREATE_FAILED',
            last_error_message: detail,
            updated_at: new Date().toISOString(),
            metadata: {
              source,
            },
          },
          { onConflict: tenantId ? 'tenant_id,plan_code' : undefined }
        );

      return NextResponse.json(
        {
          error: detail,
          code: 'ERR_LS_CHECKOUT_CREATE_FAILED',
          correlationId,
        },
        { status: 502 }
      );
    }

    const checkoutId = lsData?.data?.id ?? null;
    const checkoutUrl = lsData?.data?.attributes?.url ?? null;
    if (!checkoutId || !checkoutUrl || !isValidLemonCheckoutUrl(checkoutUrl)) {
      return NextResponse.json(
        {
          error: 'LemonSqueezy response missing checkout details',
          code: 'ERR_LS_CHECKOUT_RESPONSE_INVALID',
          correlationId,
        },
        { status: 502 }
      );
    }

    const { error: persistError } = await supabaseAdmin
      .from('billing_intents')
      .upsert(
        {
          user_id: auth.data.user.id,
          tenant_id: tenantId ?? null,
          plan_code: planCode,
          state: 'checkout_created',
          installation_id: installationId,
          installation_owner_login: selectedInstallation.accountLogin,
          checkout_id: checkoutId,
          checkout_url: checkoutUrl,
          ls_variant_id: variantId,
          ls_store_id: storeId,
          correlation_id: correlationId,
          last_error_code: null,
          last_error_message: null,
          updated_at: new Date().toISOString(),
          metadata: {
            source,
          },
        },
        { onConflict: tenantId ? 'tenant_id,plan_code' : undefined }
      );

    if (persistError) {
      return NextResponse.json(
        { error: 'Failed to persist checkout state', code: 'ERR_CHECKOUT_STATE_PERSIST_FAILED', correlationId },
        { status: 500 }
      );
    }

    console.info('[licensing.create-checkout]', {
      correlationId,
      eventKey,
      userId: auth.data.user.id,
      planCode,
      source,
      tenantId: tenantId ?? null,
      installationId,
      installationOwnerLogin: selectedInstallation.accountLogin,
      checkoutId,
      runtimeHost,
      vercelEnv,
    });

    return NextResponse.json({
      correlationId,
      state: 'checkout_created',
      checkoutId,
      checkoutUrl,
      tenantId,
      source,
      reused: false,
    });
  } catch (error: any) {
    const isAppConfigMissing = typeof error?.message === 'string' && error.message.includes('not configured');
    const errorCode = isAppConfigMissing
      ? 'ERR_GITHUB_APP_CONFIG_MISSING'
      : 'ERR_CHECKOUT_CREATE_UNHANDLED';

    console.error('[licensing.create-checkout]', {
      correlationId,
      eventKey,
      userId: auth.data.user.id,
      tenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
      source,
      code: errorCode,
      message: error?.message ?? 'Unknown error',
      runtimeHost,
      vercelEnv,
      vercelUrl,
    });

    return NextResponse.json(
      {
        error: error?.message || 'Failed to create checkout',
        code: errorCode,
        correlationId,
        environmentHint: {
          runtimeHost,
          vercelEnv,
          vercelUrl,
        },
      },
      { status: 500 }
    );
  }
}
