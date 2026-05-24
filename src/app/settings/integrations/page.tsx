import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

type OwnerIntegrationsRow = {
  vercel_oauth_token: string | null;
  vercel_team_id: string | null;
  vercel_team_slug: string | null;
  github_installation_id: number | null;
  github_account_login: string | null;
  github_account_type: string | null;
  updated_at: string | null;
};

// ----------------------------------------------------------------------------
// /settings/integrations
//
// Single-owner view of the two third-party integrations save2repo needs at
// runtime: the buyer's Vercel team and the olonjs GitHub App installation.
//
// In the happy path (Marketplace install flow, T-202) both tokens are
// provisioned automatically during install. This page is the recovery
// surface for when either one is missing, revoked, or expired — and for
// the manual showcase deploy where the owner sets things up by hand.
//
// Mutation endpoints (connect / disconnect / reconnect) are TODO for a
// later Phase 1 ticket; for now this is a read-only status panel that
// links out to the right Vercel / GitHub URLs.
// ----------------------------------------------------------------------------

const GITHUB_APP_SLUG = 'olonjs';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function IntegrationsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/setup');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/?next=/settings/integrations');

  const { data: row } = await supabase
    .from('owner_integrations')
    .select(
      'vercel_oauth_token, vercel_team_id, vercel_team_slug, github_installation_id, github_account_login, github_account_type, updated_at',
    )
    .eq('owner_user_id', user.id)
    .maybeSingle<OwnerIntegrationsRow>();

  const vercelConnected = Boolean(row?.vercel_oauth_token && row?.vercel_team_id);
  const githubConnected = Boolean(row?.github_installation_id);

  const githubInstallUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;

  // TODO(T-1xx): real Vercel OAuth flow. Until then the "Connect Vercel"
  // button links to the Vercel Marketplace integration listing — the buyer
  // can install it from there which retriggers the install callback
  // (T-A03), refreshing the token. A standalone Vercel OAuth App with a
  // proper /auth/vercel/callback route lands in a follow-up.
  const vercelConnectUrl = 'https://vercel.com/integrations/save2repo';

  return (
    <main className="min-h-dvh bg-background px-6 py-12 text-foreground">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-display tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            save2repo manages your tenant sites by calling Vercel + GitHub on
            your behalf. Keep these two connections healthy — without them,
            new tenant provisioning and content saves are blocked.
          </p>
        </header>

        <ul className="space-y-4">
          {/* Vercel ----------------------------------------------------- */}
          <li className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold">Vercel</h2>
                  <StatusBadge connected={vercelConnected} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {vercelConnected
                    ? `Connected to team ${row?.vercel_team_slug ?? row?.vercel_team_id} · updated ${timeAgo(row?.updated_at ?? null)}`
                    : 'Required to create projects, set env vars, and trigger deploys for your tenant sites.'}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <a
                href={vercelConnectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {vercelConnected ? 'Reconnect Vercel' : 'Connect Vercel'} →
              </a>
            </div>
          </li>

          {/* GitHub ----------------------------------------------------- */}
          <li className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold">GitHub App (olonjs)</h2>
                  <StatusBadge connected={githubConnected} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {githubConnected
                    ? `Installed on ${row?.github_account_login} (${row?.github_account_type ?? 'User'})`
                    : 'Required to fork templates, create tenant repos, and commit content via save2repo.'}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <a
                href={githubInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {githubConnected
                  ? 'Reconfigure GitHub App access'
                  : 'Install olonjs GitHub App'}{' '}
                →
              </a>
            </div>
          </li>
        </ul>

        <footer className="text-xs text-muted-foreground">
          The olonjs backend signs short-lived GitHub installation tokens on
          demand using its private key — save2repo never sees that key and
          cannot use the App outside your installed scopes. See ADR-006 in
          the project docs for the full trust model.
        </footer>
      </div>
    </main>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Not connected
    </span>
  );
}
