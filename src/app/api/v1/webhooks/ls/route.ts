import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseCheckoutSource, parsePlanCode, resolveCorrelationId } from '@/lib/licensing';

export const dynamic = 'force-dynamic';

function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type ResolvedWebhookContext = {
  customData: Record<string, unknown>;
  customDataPath: string;
  userId: string | null;
  tenantId: string | null;
  correlationId: string | null;
  source: string | null;
  rawPlanCode: string | null;
  planCode: string | null;
};

type ResolvedLsBillingIdentity = {
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionRenewsAt: string | null;
  portalUrl: string | null;
};

type ExistingIntentRow = {
  id: string;
  state: string | null;
  metadata: Record<string, any> | null;
  tenant_id: string | null;
  correlation_id: string | null;
  ls_customer_id: string | null;
  ls_subscription_id: string | null;
  ls_subscription_status: string | null;
  ls_subscription_renews_at: string | null;
  ls_portal_url: string | null;
};

type ExistingIntentLookup =
  | 'tenant_id'
  | 'correlation_id'
  | 'correlation_fallback_unassigned'
  | 'unassigned_latest'
  | 'none';

type EnrichedSubscriptionSnapshot = {
  subscriptionStatus: string | null;
  subscriptionRenewsAt: string | null;
  portalUrl: string | null;
};

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value > 1e12 ? value : value * 1000;
    const asDate = new Date(millis);
    return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
  }
  return null;
}

function normalizeSubscriptionStatus(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  return raw.toLowerCase().replace(/\s+/g, '_');
}

function isSafeLemonUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const allowedHost = host === 'lemonsqueezy.com' || host.endsWith('.lemonsqueezy.com');
    return parsed.protocol === 'https:' && allowedHost;
  } catch {
    return false;
  }
}

function resolveCustomData(payload: any): { customData: Record<string, unknown>; customDataPath: string } {
  const candidates: Array<{ path: string; value: unknown }> = [
    { path: 'meta.custom_data', value: payload?.meta?.custom_data },
    { path: 'meta.custom', value: payload?.meta?.custom },
    { path: 'data.attributes.custom_data', value: payload?.data?.attributes?.custom_data },
    { path: 'data.attributes.custom', value: payload?.data?.attributes?.custom },
    {
      path: 'data.attributes.first_order_item.custom_data',
      value: payload?.data?.attributes?.first_order_item?.custom_data,
    },
    { path: 'data.attributes.first_order_item.custom', value: payload?.data?.attributes?.first_order_item?.custom },
  ];

  for (const candidate of candidates) {
    if (candidate.value && typeof candidate.value === 'object' && !Array.isArray(candidate.value)) {
      return { customData: candidate.value as Record<string, unknown>, customDataPath: candidate.path };
    }
  }

  return { customData: {}, customDataPath: 'none' };
}

function resolveUserId(customData: Record<string, unknown>): string | null {
  return (
    normalizeString(customData.userId) ??
    normalizeString(customData.user_id) ??
    normalizeString(customData.userid) ??
    normalizeString(customData.userID) ??
    normalizeString((customData.user as any)?.id)
  );
}

function resolveTenantId(customData: Record<string, unknown>): string | null {
  return (
    normalizeString(customData.tenantId) ??
    normalizeString(customData.tenant_id) ??
    normalizeString(customData.tenantID) ??
    normalizeString((customData.tenant as any)?.id)
  );
}

function resolveWebhookCorrelationId(customData: Record<string, unknown>): string | null {
  return (
    normalizeString(customData.correlationId) ??
    normalizeString(customData.correlation_id) ??
    normalizeString((customData.correlation as any)?.id)
  );
}

function resolveWebhookSource(customData: Record<string, unknown>): string | null {
  const rawSource =
    normalizeString(customData.source) ??
    normalizeString(customData.checkoutSource) ??
    normalizeString(customData.checkout_source);
  return parseCheckoutSource(rawSource) ?? null;
}

function resolvePlanCodeFromVariantId(variantId: string | null): string | null {
  if (!variantId) return null;
  const starterVariantId = process.env.LS_VARIANT_STARTER_ID?.trim() ?? '';
  const proVariantId = process.env.LS_VARIANT_PRO_ID?.trim() ?? '';
  const businessVariantId = process.env.LS_VARIANT_BUSINESS_ID?.trim() ?? '';
  if (starterVariantId && variantId === starterVariantId) return 'starter';
  if (proVariantId && variantId === proVariantId) return 'pro';
  if (businessVariantId && variantId === businessVariantId) return 'business';
  return null;
}

function resolvePlanCode(payload: any, customData: Record<string, unknown>): { rawPlanCode: string | null; planCode: string | null } {
  const rawPlanCode =
    normalizeString(customData.planCode) ??
    normalizeString(customData.plan_code) ??
    normalizeString(customData.plan) ??
    normalizeString((customData.variant as any)?.name);

  const variantId =
    normalizeId(payload?.data?.attributes?.variant_id) ??
    normalizeId(payload?.data?.attributes?.variantId) ??
    normalizeId(payload?.data?.attributes?.first_order_item?.variant_id) ??
    normalizeId(payload?.data?.attributes?.first_subscription_item?.variant_id) ??
    normalizeId(payload?.data?.relationships?.variant?.data?.id);

  const planCode =
    parsePlanCode(rawPlanCode) ??
    parsePlanCode(resolvePlanCodeFromVariantId(variantId)) ??
    null;
  return { rawPlanCode, planCode };
}

function resolveWebhookContext(payload: any): ResolvedWebhookContext {
  const { customData, customDataPath } = resolveCustomData(payload);
  const userId = resolveUserId(customData);
  const tenantId = resolveTenantId(customData);
  const resolvedCorrelationId = resolveWebhookCorrelationId(customData);
  const { rawPlanCode, planCode } = resolvePlanCode(payload, customData);
  const source = resolveWebhookSource(customData);
  return {
    customData,
    customDataPath,
    userId,
    tenantId,
    correlationId: resolvedCorrelationId,
    source,
    rawPlanCode,
    planCode,
  };
}

function buildNonPostResponse(correlationId: string, method: string) {
  console.warn('[licensing.webhook.ls]', {
    correlationId,
    code: 'WARN_LS_WEBHOOK_NON_POST',
    method,
  });
  return NextResponse.json(
    {
      ok: true,
      ignored: true,
      reason: 'method_not_allowed_for_events',
      acceptedMethod: 'POST',
      correlationId,
    },
    { status: 200 }
  );
}

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get('x-correlation-id'));
  return buildNonPostResponse(correlationId, 'GET');
}

export async function HEAD(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get('x-correlation-id'));
  return buildNonPostResponse(correlationId, 'HEAD');
}

function resolveLsBillingIdentity(payload: any, customData: Record<string, unknown>): ResolvedLsBillingIdentity {
  const attributes = payload?.data?.attributes ?? {};
  const relationships = payload?.data?.relationships ?? {};
  const dataType = normalizeString(payload?.data?.type) ?? '';
  const dataId = normalizeId(payload?.data?.id);

  const customerId =
    normalizeId(customData.customerId) ??
    normalizeId(customData.customer_id) ??
    normalizeId(attributes?.customer_id) ??
    normalizeId(attributes?.customerId) ??
    normalizeId(attributes?.first_order_item?.customer_id) ??
    normalizeId(attributes?.first_order_item?.customerId) ??
    normalizeId(relationships?.customer?.data?.id);

  const subscriptionId =
    normalizeId(customData.subscriptionId) ??
    normalizeId(customData.subscription_id) ??
    normalizeId(attributes?.subscription_id) ??
    normalizeId(attributes?.subscriptionId) ??
    normalizeId(relationships?.subscription?.data?.id) ??
    // subscription object payloads expose id as data.id
    (dataType === 'subscriptions' ? dataId : null);

  const subscriptionStatus =
    normalizeSubscriptionStatus(customData.subscriptionStatus) ??
    normalizeSubscriptionStatus(customData.subscription_status) ??
    normalizeSubscriptionStatus(attributes?.status) ??
    normalizeSubscriptionStatus(attributes?.subscription_status) ??
    normalizeSubscriptionStatus(attributes?.subscriptionStatus);

  const subscriptionRenewsAt =
    normalizeTimestamp(attributes?.renews_at) ??
    normalizeTimestamp(attributes?.current_period_end) ??
    normalizeTimestamp(attributes?.ends_at) ??
    normalizeTimestamp(attributes?.trial_ends_at) ??
    normalizeTimestamp(attributes?.billing_anchor) ??
    normalizeTimestamp(customData.renewsAt) ??
    normalizeTimestamp(customData.renews_at);

  const rawPortalUrl =
    normalizeString(attributes?.urls?.customer_portal) ??
    normalizeString(attributes?.portal_url) ??
    normalizeString(attributes?.customer_portal_url) ??
    normalizeString((attributes?.urls as any)?.portal);
  const portalUrl = isSafeLemonUrl(rawPortalUrl) ? rawPortalUrl : null;

  return {
    customerId,
    subscriptionId,
    subscriptionStatus,
    subscriptionRenewsAt,
    portalUrl,
  };
}

function buildEventKey(payload: any, resolvedUserId: string | null, resolvedTenantId: string | null): string {
  const eventName = payload?.meta?.event_name ?? 'unknown';
  const dataId = payload?.data?.id ?? 'no_data_id';
  const customUserId = resolvedUserId ?? 'no_user';
  const customTenantId = resolvedTenantId ?? 'no_tenant';
  return `${eventName}:${dataId}:${customUserId}:${customTenantId}`;
}

function shouldRetryLsRead(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchLsSubscriptionSnapshot(params: {
  subscriptionId: string;
  apiKey: string;
  correlationId: string;
  eventName: string;
  eventKey: string;
}): Promise<EnrichedSubscriptionSnapshot | null> {
  const { subscriptionId, apiKey, correlationId, eventName, eventKey } = params;
  const url = `https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.api+json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt < maxAttempts && shouldRetryLsRead(response.status)) {
          continue;
        }
        console.warn('[licensing.webhook.ls]', {
          correlationId,
          eventName,
          eventKey,
          code: 'WARN_LS_SUBSCRIPTION_ENRICH_HTTP',
          status: response.status,
          attempt,
        });
        return null;
      }

      const body = await response.json().catch(() => ({}));
      const attributes = body?.data?.attributes ?? {};
      const rawPortalUrl =
        normalizeString(attributes?.urls?.customer_portal) ??
        normalizeString(attributes?.portal_url) ??
        normalizeString(attributes?.customer_portal_url) ??
        normalizeString((attributes?.urls as any)?.portal);

      return {
        subscriptionStatus:
          normalizeSubscriptionStatus(attributes?.status) ??
          normalizeSubscriptionStatus(attributes?.subscription_status) ??
          null,
        subscriptionRenewsAt:
          normalizeTimestamp(attributes?.renews_at) ??
          normalizeTimestamp(attributes?.current_period_end) ??
          normalizeTimestamp(attributes?.ends_at) ??
          normalizeTimestamp(attributes?.trial_ends_at) ??
          null,
        portalUrl: isSafeLemonUrl(rawPortalUrl) ? rawPortalUrl : null,
      };
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      if (attempt < maxAttempts) {
        continue;
      }
      console.warn('[licensing.webhook.ls]', {
        correlationId,
        eventName,
        eventKey,
        code: isAbort ? 'WARN_LS_SUBSCRIPTION_ENRICH_TIMEOUT' : 'WARN_LS_SUBSCRIPTION_ENRICH_ERROR',
        attempt,
        message: error?.message ?? null,
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

async function resolveExistingIntent(params: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  planCode: string;
  tenantId: string | null;
  correlationId: string | null;
}) {
  const { supabaseAdmin, userId, planCode, tenantId, correlationId } = params;
  const baseQuery = () =>
    supabaseAdmin
      .from('billing_intents')
      .select(
        'id, state, metadata, tenant_id, correlation_id, ls_customer_id, ls_subscription_id, ls_subscription_status, ls_subscription_renews_at, ls_portal_url'
      )
      .eq('user_id', userId)
      .eq('plan_code', planCode)
      .order('updated_at', { ascending: false })
      .limit(1);

  if (tenantId) {
    const byTenant = await baseQuery().eq('tenant_id', tenantId).maybeSingle();
    return {
      data: (byTenant.data ?? null) as ExistingIntentRow | null,
      error: byTenant.error,
      lookup: 'tenant_id' as ExistingIntentLookup,
    };
  }

  if (correlationId) {
    const byCorrelation = await baseQuery().eq('correlation_id', correlationId).maybeSingle();
    if (byCorrelation.error || byCorrelation.data) {
      return {
        data: (byCorrelation.data ?? null) as ExistingIntentRow | null,
        error: byCorrelation.error,
        lookup: 'correlation_id' as ExistingIntentLookup,
      };
    }

    const fallbackUnassigned = await baseQuery().is('tenant_id', null).maybeSingle();
    return {
      data: (fallbackUnassigned.data ?? null) as ExistingIntentRow | null,
      error: fallbackUnassigned.error,
      lookup: fallbackUnassigned.data
        ? ('correlation_fallback_unassigned' as ExistingIntentLookup)
        : ('none' as ExistingIntentLookup),
    };
  }

  const latestUnassigned = await baseQuery().is('tenant_id', null).maybeSingle();
  return {
    data: (latestUnassigned.data ?? null) as ExistingIntentRow | null,
    error: latestUnassigned.error,
    lookup: latestUnassigned.data ? ('unassigned_latest' as ExistingIntentLookup) : ('none' as ExistingIntentLookup),
  };
}

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get('x-correlation-id'));

  const secret = process.env.LS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Missing LS_WEBHOOK_SECRET', code: 'ERR_LS_WEBHOOK_SECRET_MISSING', correlationId },
      { status: 500 }
    );
  }

  const signature = req.headers.get('x-signature') ?? '';
  const rawBody = await req.text();
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!timingSafeCompare(signature, digest)) {
    console.warn('[licensing.webhook.ls]', {
      correlationId,
      code: 'ERR_LS_WEBHOOK_SIGNATURE_INVALID',
    });
    return NextResponse.json(
      { error: 'Invalid webhook signature', code: 'ERR_LS_WEBHOOK_SIGNATURE_INVALID', correlationId },
      { status: 401 }
    );
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload', code: 'ERR_LS_WEBHOOK_JSON_INVALID', correlationId },
      { status: 400 }
    );
  }

  const eventName: string = payload?.meta?.event_name ?? 'unknown';
  const resolvedContext = resolveWebhookContext(payload);
  let resolvedBillingIdentity = resolveLsBillingIdentity(payload, resolvedContext.customData);
  const eventKey = buildEventKey(payload, resolvedContext.userId, resolvedContext.tenantId);

  const canTryEnrichment =
    !resolvedBillingIdentity.subscriptionRenewsAt &&
    !!resolvedBillingIdentity.subscriptionId &&
    eventName.startsWith('subscription_');
  const lsApiKey = process.env.LS_API_KEY?.trim() ?? '';
  if (canTryEnrichment && lsApiKey) {
    const enrichedSnapshot = await fetchLsSubscriptionSnapshot({
      subscriptionId: resolvedBillingIdentity.subscriptionId as string,
      apiKey: lsApiKey,
      correlationId,
      eventName,
      eventKey,
    });
    if (enrichedSnapshot) {
      resolvedBillingIdentity = {
        ...resolvedBillingIdentity,
        subscriptionStatus: resolvedBillingIdentity.subscriptionStatus ?? enrichedSnapshot.subscriptionStatus,
        subscriptionRenewsAt: resolvedBillingIdentity.subscriptionRenewsAt ?? enrichedSnapshot.subscriptionRenewsAt,
        portalUrl: resolvedBillingIdentity.portalUrl ?? enrichedSnapshot.portalUrl,
      };
    }
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error: eventError } = await supabaseAdmin.from('billing_webhook_events').insert({
    event_key: eventKey,
    event_name: eventName,
    payload,
  });

  if (eventError && eventError.code !== '23505') {
    return NextResponse.json(
      { error: 'Failed to persist webhook event', code: 'ERR_LS_WEBHOOK_EVENT_PERSIST_FAILED', correlationId },
      { status: 500 }
    );
  }

  const isDuplicateEvent = eventError?.code === '23505';
  if (isDuplicateEvent) {
    console.info('[licensing.webhook.ls]', {
      correlationId,
      eventName,
      eventKey,
      duplicate: true,
    });
  }

  if (!resolvedContext.userId) {
    console.warn('[licensing.webhook.ls]', {
      correlationId,
      eventName,
      eventKey,
      ignored: true,
      reason: 'missing_user',
      customDataPath: resolvedContext.customDataPath,
      customDataKeys: Object.keys(resolvedContext.customData),
    });
    return NextResponse.json({ ok: true, ignored: true, reason: 'missing_user', correlationId });
  }

  if (!resolvedContext.planCode) {
    console.warn('[licensing.webhook.ls]', {
      correlationId,
      eventName,
      eventKey,
      ignored: true,
      reason: 'invalid_plan',
      customDataPath: resolvedContext.customDataPath,
      rawPlanCode: resolvedContext.rawPlanCode,
    });
    return NextResponse.json(
      {
        ok: true,
        ignored: true,
        reason: 'invalid_plan',
        correlationId,
        rawPlanCode: resolvedContext.rawPlanCode,
        duplicate: isDuplicateEvent,
      },
      { status: 200 }
    );
  }

  const successEvents = new Set([
    'order_created',
    'subscription_created',
    'subscription_payment_success',
  ]);

  const {
    data: existingIntent,
    error: existingIntentError,
    lookup: existingIntentLookup,
  } = await resolveExistingIntent({
    supabaseAdmin,
    userId: resolvedContext.userId,
    planCode: resolvedContext.planCode,
    tenantId: resolvedContext.tenantId,
    correlationId: resolvedContext.correlationId,
  });

  if (existingIntentError) {
    return NextResponse.json(
      { error: 'Failed to load billing intent state', code: 'ERR_LS_WEBHOOK_STATE_READ_FAILED', correlationId },
      { status: 500 }
    );
  }

  const successState = resolvedContext.tenantId ? 'licensed_ready_assigned' : 'licensed_ready_unassigned';
  const baseNextState = successEvents.has(eventName) ? successState : 'payment_pending';
  const isAlreadyLicensed =
    existingIntent?.state === 'licensed_ready' ||
    existingIntent?.state === 'licensed_ready_assigned' ||
    existingIntent?.state === 'licensed_ready_unassigned';
  const alreadyAssigned = existingIntent?.state === 'licensed_ready_assigned' || (existingIntent?.state === 'licensed_ready' && !!existingIntent?.tenant_id);
  const nextState = isAlreadyLicensed
    ? alreadyAssigned
      ? 'licensed_ready_assigned'
      : 'licensed_ready_unassigned'
    : baseNextState;
  const preventedRegression = isAlreadyLicensed && baseNextState === 'payment_pending';

  const nextPayload = {
    user_id: resolvedContext.userId,
    tenant_id: resolvedContext.tenantId ?? existingIntent?.tenant_id ?? null,
    plan_code: resolvedContext.planCode,
    state: nextState,
    // Do not regress previously known values on partial webhook events.
    ls_customer_id: resolvedBillingIdentity.customerId ?? null,
    ls_subscription_id: resolvedBillingIdentity.subscriptionId ?? null,
    ls_subscription_status: resolvedBillingIdentity.subscriptionStatus ?? null,
    ls_subscription_renews_at: resolvedBillingIdentity.subscriptionRenewsAt ?? null,
    ls_portal_url: resolvedBillingIdentity.portalUrl ?? null,
    // Preserve original checkout correlation when webhook payload has no custom correlation.
    correlation_id: resolvedContext.correlationId ?? existingIntent?.correlation_id ?? correlationId,
    last_error_code: null,
    last_error_message: null,
    updated_at: new Date().toISOString(),
    metadata: {
      ...(existingIntent?.metadata ?? {}),
      tenantId: resolvedContext.tenantId ?? existingIntent?.tenant_id ?? null,
      webhookEvent: eventName,
      webhookEventKey: eventKey,
      webhookCustomDataPath: resolvedContext.customDataPath,
      source: resolvedContext.source ?? existingIntent?.metadata?.source ?? 'unknown',
      webhookSource: 'lemonsqueezy',
      webhookCustomerId: resolvedBillingIdentity.customerId,
      webhookSubscriptionId: resolvedBillingIdentity.subscriptionId,
      webhookSubscriptionStatus: resolvedBillingIdentity.subscriptionStatus,
      webhookSubscriptionRenewsAt: resolvedBillingIdentity.subscriptionRenewsAt,
    },
  };

  if (existingIntent) {
    if (!nextPayload.ls_customer_id) nextPayload.ls_customer_id = (existingIntent as any).ls_customer_id ?? null;
    if (!nextPayload.ls_subscription_id) nextPayload.ls_subscription_id = (existingIntent as any).ls_subscription_id ?? null;
    if (!nextPayload.ls_subscription_status) {
      nextPayload.ls_subscription_status = (existingIntent as any).ls_subscription_status ?? null;
    }
    if (!nextPayload.ls_subscription_renews_at) {
      nextPayload.ls_subscription_renews_at = (existingIntent as any).ls_subscription_renews_at ?? null;
    }
    if (!nextPayload.ls_portal_url) nextPayload.ls_portal_url = (existingIntent as any).ls_portal_url ?? null;
  }

  if (successEvents.has(eventName) && (!resolvedBillingIdentity.customerId || !resolvedBillingIdentity.subscriptionId)) {
    console.warn('[licensing.webhook.ls]', {
      correlationId,
      eventName,
      eventKey,
      code: 'WARN_LS_BILLING_IDENTITY_INCOMPLETE',
      customerId: resolvedBillingIdentity.customerId,
      subscriptionId: resolvedBillingIdentity.subscriptionId,
      customDataPath: resolvedContext.customDataPath,
    });
  }

  const { error: upsertError } = existingIntent?.id
    ? await supabaseAdmin.from('billing_intents').update(nextPayload).eq('id', existingIntent.id)
    : resolvedContext.tenantId
      ? await supabaseAdmin.from('billing_intents').upsert(nextPayload, { onConflict: 'tenant_id,plan_code' })
      : await supabaseAdmin.from('billing_intents').insert(nextPayload);

  if (upsertError) {
    return NextResponse.json(
      { error: 'Failed to update billing intent', code: 'ERR_LS_WEBHOOK_STATE_PERSIST_FAILED', correlationId },
      { status: 500 }
    );
  }

  console.info('[licensing.webhook.ls]', {
    correlationId,
    eventName,
    eventKey,
    userId: resolvedContext.userId,
    tenantId: resolvedContext.tenantId,
    planCode: resolvedContext.planCode,
    webhookCorrelationId: resolvedContext.correlationId,
    source: resolvedContext.source,
    customDataPath: resolvedContext.customDataPath,
    customerId: resolvedBillingIdentity.customerId,
    subscriptionId: resolvedBillingIdentity.subscriptionId,
    subscriptionStatus: resolvedBillingIdentity.subscriptionStatus,
    subscriptionRenewsAt: resolvedBillingIdentity.subscriptionRenewsAt,
    previousState: existingIntent?.state ?? null,
    existingIntentLookup,
    preventedRegression,
    state: nextState,
  });

  return NextResponse.json({ ok: true, eventName, state: nextState, correlationId, duplicate: isDuplicateEvent });
}
