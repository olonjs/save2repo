import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveCorrelationId } from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeLemonUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('lemonsqueezy.com');
  } catch {
    return false;
  }
}

function extractCustomerPortalUrl(payload: any): string | null {
  const candidate =
    payload?.data?.attributes?.urls?.customer_portal ??
    payload?.data?.attributes?.portal_url ??
    payload?.data?.attributes?.customer_portal_url ??
    null;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  return candidate.trim();
}

async function fetchPortalUrlFromLemon(
  customerId: string,
  apiKey: string
): Promise<
  | { ok: true; portalUrl: string }
  | { ok: false; code: 'ERR_PORTAL_PROVIDER_FAILED' | 'ERR_PORTAL_LINK_UNAVAILABLE'; providerMessage: string }
> {
  const response = await fetch(`https://api.lemonsqueezy.com/v1/customers/${encodeURIComponent(customerId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = payload?.errors?.[0]?.detail || payload?.message || 'Failed to fetch Lemon customer';
    return { ok: false, code: 'ERR_PORTAL_PROVIDER_FAILED', providerMessage };
  }
  const portalUrl = extractCustomerPortalUrl(payload);
  if (!portalUrl || !isSafeLemonUrl(portalUrl)) {
    return {
      ok: false,
      code: 'ERR_PORTAL_LINK_UNAVAILABLE',
      providerMessage: 'Portal URL missing or invalid in Lemon response',
    };
  }
  return { ok: true, portalUrl };
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

  const apiKey = process.env.LS_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return NextResponse.json(
      { error: 'LemonSqueezy API key missing', code: 'ERR_PORTAL_PROVIDER_CONFIG_MISSING', correlationId },
      { status: 500 }
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

  let row: any = null;
  if (tenantId) {
    const tenantScoped = await supabaseAdmin
      .from('billing_intents')
      .select('id, ls_customer_id, ls_portal_url, updated_at')
      .eq('user_id', auth.data.user.id)
      .eq('tenant_id', tenantId)
      .not('ls_customer_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = tenantScoped.data ?? null;
  }
  if (!row) {
    const userScoped = await supabaseAdmin
      .from('billing_intents')
      .select('id, ls_customer_id, ls_portal_url, updated_at')
      .eq('user_id', auth.data.user.id)
      .not('ls_customer_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = userScoped.data ?? null;
  }

  const customerId = typeof row?.ls_customer_id === 'string' ? row.ls_customer_id : null;
  if (!customerId) {
    return NextResponse.json(
      { error: 'No Lemon customer mapping available', code: 'ERR_PORTAL_CUSTOMER_NOT_FOUND', correlationId },
      { status: 404 }
    );
  }

  const provider = await fetchPortalUrlFromLemon(customerId, apiKey);
  if (!provider.ok) {
    console.error('[licensing.portal]', {
      correlationId,
      code: provider.code,
      userId: auth.data.user.id,
      tenantId,
      customerId,
      providerMessage: provider.providerMessage,
    });
    return NextResponse.json(
      {
        error: provider.providerMessage,
        code: provider.code,
        correlationId,
      },
      { status: provider.code === 'ERR_PORTAL_LINK_UNAVAILABLE' ? 404 : 502 }
    );
  }

  const portalUrl = provider.portalUrl;
  if (!isSafeLemonUrl(portalUrl)) {
    return NextResponse.json(
      { error: 'Portal URL unavailable', code: 'ERR_PORTAL_LINK_UNAVAILABLE', correlationId },
      { status: 502 }
    );
  }

  await supabaseAdmin
    .from('billing_intents')
    .update({
      ls_portal_url: portalUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', auth.data.user.id)
    .eq('ls_customer_id', customerId);

  return NextResponse.json({
    correlationId,
    tenantId,
    customerId,
    portalUrl,
  });
}
