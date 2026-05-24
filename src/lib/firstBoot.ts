// ----------------------------------------------------------------------------
// save2repo first-boot detection.
//
// At runtime a save2repo deployment needs three pieces of context wired:
//
//   1. Supabase env vars (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY + SERVICE_ROLE_KEY)
//      — injected automatically by the Supabase Vercel Marketplace integration
//      (ADR-007).
//   2. SAVE2REPO_DEPLOYMENT_TOKEN — the registration token plaintext issued
//      by the olonjs install callback (T-A03); persisted as a hash in
//      jsonpages-platform's save2repo_deployments table (ADR-006). Required at
//      runtime to authenticate calls to the olonjs token-signing endpoint.
//   3. OLONJS_API_BASE — base URL of the olonjs backend (defaults to
//      `https://app.olon.it/api/v1` if not set).
//
// `checkDeploymentEnv()` returns a structured report so the middleware can
// redirect to /setup with a clear list of what is missing, instead of letting
// the app crash on first auth call.
//
// The schema baseline itself (migration 00000000000000_save2repo_baseline.sql)
// is applied via Supabase CLI at the buyer's setup time — see the
// "Deploying the showcase" section in README.md. Runtime auto-migrate is a
// follow-up (planned in a T-1xx) once we are confident the DB role has the
// privileges required to CREATE EXTENSION pgsodium and trigger on auth.users.
// ----------------------------------------------------------------------------

export type DeploymentEnvKey =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'SAVE2REPO_DEPLOYMENT_TOKEN'
  | 'OLONJS_API_BASE';

export type DeploymentEnvCheck = {
  ok: boolean;
  missing: DeploymentEnvKey[];
  placeholder: DeploymentEnvKey[];
  supabaseConfigured: boolean;
  deploymentTokenPresent: boolean;
  olonjsApiBase: string;
};

const PLACEHOLDER_VALUES = new Set([
  'placeholder',
  'https://placeholder.supabase.co',
]);

function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return false;
  if (PLACEHOLDER_VALUES.has(value)) return true;
  if (value.includes('placeholder.supabase')) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Bootstrap seed consumer (T-A06).
//
// At first login post-Marketplace-install, the deployed save2repo calls
// jsonpages-platform's GET /api/v1/deployments/self/bootstrap with its
// SAVE2REPO_DEPLOYMENT_TOKEN to retrieve seed data (Vercel OAuth token,
// vercel_team_id, github_installation_id) and populate owner_integrations.
// Idempotent + write-if-not-exists: subsequent logins no-op once populated.
//
// Failure modes (all non-fatal — caller must NOT block login):
//   - token missing (showcase manual deploy or env not yet injected): skip
//   - 401 from olonjs (unknown token): skip
//   - 5xx / network: log + skip; UI's /settings/integrations falls back to
//     manual "Connect Vercel" path (T-103 showcase mode).
// ----------------------------------------------------------------------------

export type BootstrapSeedResponse = {
  vercel_oauth_token: string | null;
  vercel_team_id: string;
  github_installation_id: number | null;
  supabase_auth_provider_configured: boolean;
  correlationId?: string;
};

export async function fetchBootstrapSeed(): Promise<BootstrapSeedResponse | null> {
  const token = process.env.SAVE2REPO_DEPLOYMENT_TOKEN?.trim();
  if (!token) return null;
  const base =
    process.env.OLONJS_API_BASE?.trim() || 'https://app.olon.it/api/v1';
  const url = `${base.replace(/\/$/, '')}/deployments/self/bootstrap`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    throw new Error(`Bootstrap fetch network error: ${message}`);
  }
  if (res.status === 401) return null; // showcase / stale token: non-fatal
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bootstrap fetch ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as BootstrapSeedResponse;
}

/**
 * Populate owner_integrations row from bootstrap seed, idempotent.
 *
 * Returns:
 *   - 'skipped' if no seed (showcase manual, missing token, 401)
 *   - 'already-seeded' if owner_integrations row exists for this user
 *   - 'seeded' if a new row was written
 *
 * Throws on hard infrastructure errors (Supabase admin client missing,
 * insert failure). The caller (auth/callback) should catch + log, never
 * block login on seed failure.
 */
export async function ensureOwnerIntegrationsSeeded(
  ownerUserId: string,
): Promise<'skipped' | 'already-seeded' | 'seeded'> {
  const seed = await fetchBootstrapSeed();
  if (!seed) return 'skipped';
  // Lazy import to avoid coupling firstBoot.ts to the Supabase client at module
  // load time (firstBoot is read from middleware and the admin client is
  // server-only).
  const { getSupabaseAdmin } = await import('@/lib/supabase');
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selErr } = await supabase
    .from('owner_integrations')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  if (selErr) {
    throw new Error(`owner_integrations lookup failed: ${selErr.message}`);
  }
  if (existing) return 'already-seeded';

  const { error: insErr } = await supabase.from('owner_integrations').insert({
    owner_user_id: ownerUserId,
    vercel_oauth_token: seed.vercel_oauth_token,
    vercel_team_id: seed.vercel_team_id,
    github_installation_id: seed.github_installation_id,
  });
  if (insErr) {
    throw new Error(`owner_integrations insert failed: ${insErr.message}`);
  }
  return 'seeded';
}

export function checkDeploymentEnv(): DeploymentEnvCheck {
  const required: DeploymentEnvKey[] = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SAVE2REPO_DEPLOYMENT_TOKEN',
  ];

  const missing: DeploymentEnvKey[] = [];
  const placeholder: DeploymentEnvKey[] = [];

  for (const key of required) {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      missing.push(key);
    } else if (isPlaceholderValue(value)) {
      placeholder.push(key);
    }
  }

  const supabaseConfigured =
    !missing.includes('NEXT_PUBLIC_SUPABASE_URL') &&
    !missing.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY') &&
    !placeholder.includes('NEXT_PUBLIC_SUPABASE_URL') &&
    !placeholder.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  const deploymentTokenPresent = !missing.includes('SAVE2REPO_DEPLOYMENT_TOKEN');

  return {
    ok: missing.length === 0 && placeholder.length === 0,
    missing,
    placeholder,
    supabaseConfigured,
    deploymentTokenPresent,
    olonjsApiBase:
      process.env.OLONJS_API_BASE?.trim() || 'https://app.olon.it/api/v1',
  };
}
