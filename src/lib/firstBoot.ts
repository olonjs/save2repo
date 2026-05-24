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
