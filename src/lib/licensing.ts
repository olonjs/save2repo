import { randomUUID } from 'crypto';
import { App } from 'octokit';
import { getSupabaseAdmin } from '@/lib/supabase';

export type BillingState =
  | 'authenticated'
  | 'bridge_missing'
  | 'bridge_ready'
  | 'checkout_created'
  | 'payment_pending'
  | 'licensed_ready'
  | 'licensed_ready_unassigned'
  | 'licensed_ready_assigned';

export type PlanCode = 'starter' | 'pro' | 'business';
export type CheckoutSource = 'cloud' | 'app';

export type UserInstallation = {
  id: number;
  accountLogin: string;
  accountType: string | null;
};

const SUPPORTED_PLAN_CODES = new Set<PlanCode>(['starter', 'pro', 'business']);
const SUPPORTED_CHECKOUT_SOURCES = new Set<CheckoutSource>(['cloud', 'app']);

export const LS_REQUIRED_ENV_KEYS = [
  'LS_API_KEY',
  'LS_STORE_ID',
  'LS_VARIANT_STARTER_ID',
  'LS_VARIANT_PRO_ID',
  'LS_VARIANT_BUSINESS_ID',
] as const;
export type LsRequiredEnvKey = (typeof LS_REQUIRED_ENV_KEYS)[number];

const LS_VARIANT_ENV_KEY_BY_PLAN: Record<PlanCode, LsRequiredEnvKey> = {
  starter: 'LS_VARIANT_STARTER_ID',
  pro: 'LS_VARIANT_PRO_ID',
  business: 'LS_VARIANT_BUSINESS_ID',
};

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function getMissingLsEnvKeys(planCode: PlanCode, env: Record<string, string | undefined> = process.env): LsRequiredEnvKey[] {
  const requiredKeys: LsRequiredEnvKey[] = [
    'LS_API_KEY',
    'LS_STORE_ID',
    LS_VARIANT_ENV_KEY_BY_PLAN[planCode],
  ];

  return requiredKeys.filter((key) => !hasEnvValue(env[key]));
}

export function resolveCorrelationId(requestId: string | null): string {
  return requestId && requestId.trim() ? requestId.trim() : randomUUID();
}

export function parsePlanCode(value: string | null | undefined): PlanCode | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as PlanCode;
  return SUPPORTED_PLAN_CODES.has(normalized) ? normalized : null;
}

export function parseCheckoutSource(value: string | null | undefined): CheckoutSource | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as CheckoutSource;
  return SUPPORTED_CHECKOUT_SOURCES.has(normalized) ? normalized : null;
}

export function resolveCheckoutSource(
  value: string | null | undefined,
  fallback: CheckoutSource = 'app'
): CheckoutSource {
  return parseCheckoutSource(value) ?? fallback;
}

export function resolveVariantIdByPlan(planCode: PlanCode): string | null {
  const map: Record<PlanCode, string | undefined> = {
    starter: process.env.LS_VARIANT_STARTER_ID,
    pro: process.env.LS_VARIANT_PRO_ID,
    business: process.env.LS_VARIANT_BUSINESS_ID,
  };

  const variantId = map[planCode];
  return variantId && variantId.trim() ? variantId.trim() : null;
}

function resolveInstallationAccount(account: unknown): { accountLogin: string; accountType: string | null } {
  const accountLogin =
    account && typeof account === 'object'
      ? 'login' in account && typeof account.login === 'string'
        ? account.login
        : 'slug' in account && typeof account.slug === 'string'
          ? account.slug
          : 'name' in account && typeof account.name === 'string'
            ? account.name
            : ''
      : '';
  const accountType =
    account && typeof account === 'object' && 'type' in account && typeof account.type === 'string'
      ? account.type
      : null;

  return { accountLogin, accountType };
}

export function getGithubAppClient(): App {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GitHub App is not configured');
  }

  return new App({
    appId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  });
}

export async function getAppInstallationById(installationId: number): Promise<UserInstallation | null> {
  const app = getGithubAppClient();

  try {
    const response = await app.octokit.request('GET /app/installations/{installation_id}', {
      installation_id: installationId,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const installation = response.data;
    const { accountLogin, accountType } = resolveInstallationAccount(installation.account);

    return {
      id: installation.id,
      accountLogin,
      accountType,
    };
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

export async function listAppInstallations(): Promise<UserInstallation[]> {
  const app = getGithubAppClient();
  const installations: UserInstallation[] = [];
  let page = 1;

  while (true) {
    const response = await app.octokit.request('GET /app/installations', {
      per_page: 100,
      page,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const pageInstallations = Array.isArray(response.data) ? response.data : [];
    for (const installation of pageInstallations) {
      const { accountLogin, accountType } = resolveInstallationAccount(installation.account);
      installations.push({
        id: installation.id,
        accountLogin,
        accountType,
      });
    }

    if (pageInstallations.length < 100) break;
    page += 1;
  }

  return installations;
}

export function isSubscriptionStatusActive(status: string | null | undefined): boolean {
  if (!status || typeof status !== 'string') return false;
  const normalized = status.trim().toLowerCase();
  return ['active', 'paid', 'trialing', 'on_trial'].includes(normalized);
}

export async function hasActivePaidEntitlement(params: {
  userId: string;
  tenantId?: string | null;
}): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin();
  const licensedStates: BillingState[] = [
    'licensed_ready',
    'licensed_ready_assigned',
    'licensed_ready_unassigned',
  ];

  const byTenant = params.tenantId
    ? await supabaseAdmin
        .from('billing_intents')
        .select('state, ls_subscription_status, updated_at')
        .eq('user_id', params.userId)
        .eq('tenant_id', params.tenantId)
        .in('state', licensedStates)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };

  if (byTenant.error) {
    throw byTenant.error;
  }

  let candidate = byTenant.data;
  if (!candidate) {
    const fallback = await supabaseAdmin
      .from('billing_intents')
      .select('state, ls_subscription_status, updated_at')
      .eq('user_id', params.userId)
      .in('state', licensedStates)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.error) {
      throw fallback.error;
    }
    candidate = fallback.data;
  }

  if (!candidate) return false;
  return (
    candidate.state === 'licensed_ready' ||
    candidate.state === 'licensed_ready_assigned' ||
    candidate.state === 'licensed_ready_unassigned' ||
    isSubscriptionStatusActive(candidate.ls_subscription_status)
  );
}
