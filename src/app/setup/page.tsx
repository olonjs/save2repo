import Link from 'next/link';
import { checkDeploymentEnv, type DeploymentEnvKey } from '@/lib/firstBoot';

export const dynamic = 'force-dynamic';

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  status: 'ok' | 'missing' | 'placeholder';
  action?: { label: string; href: string; external?: boolean };
};

function buildChecklist(env: ReturnType<typeof checkDeploymentEnv>): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // Supabase
  const supabaseKeys: DeploymentEnvKey[] = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const supabaseMissing = supabaseKeys.some(
    (k) => env.missing.includes(k) || env.placeholder.includes(k),
  );
  items.push({
    id: 'supabase',
    title: 'Supabase project',
    description: supabaseMissing
      ? 'Supabase env vars are missing. Install the Supabase Marketplace integration in your Vercel team — it auto-injects URL, anon key, service role and JWT secret into this project.'
      : 'Supabase env vars are configured.',
    status: supabaseMissing ? 'missing' : 'ok',
    action: supabaseMissing
      ? {
          label: 'Install Supabase integration',
          href: 'https://vercel.com/integrations/supabase/new',
          external: true,
        }
      : undefined,
  });

  // SAVE2REPO_DEPLOYMENT_TOKEN
  const tokenMissing =
    env.missing.includes('SAVE2REPO_DEPLOYMENT_TOKEN') ||
    env.placeholder.includes('SAVE2REPO_DEPLOYMENT_TOKEN');
  items.push({
    id: 'deployment-token',
    title: 'save2repo deployment token',
    description: tokenMissing
      ? 'SAVE2REPO_DEPLOYMENT_TOKEN env var is missing. In production this is injected by the Marketplace install callback (vercel.com/integrations/save2repo). For a manual showcase deploy, generate a random 32-char hex value, paste it here in Vercel env, and pre-insert a matching row into save2repo_deployments on app.olon.it.'
      : 'Deployment token is set.',
    status: tokenMissing ? 'missing' : 'ok',
    action: tokenMissing
      ? {
          label: 'Set env in Vercel project',
          href: 'https://vercel.com/dashboard',
          external: true,
        }
      : undefined,
  });

  // Schema baseline
  items.push({
    id: 'schema',
    title: 'Database schema baseline',
    description:
      'Apply supabase/migrations/00000000000000_save2repo_baseline.sql to your Supabase project (Supabase Studio → SQL editor, or `supabase db push` via CLI). Required extensions: pgcrypto + pgsodium (Database → Extensions). Runtime auto-migrate is a follow-up — for now this is a one-time manual step.',
    status: 'missing',
    action: {
      label: 'Open Supabase Studio',
      href: 'https://supabase.com/dashboard',
      external: true,
    },
  });

  return items;
}

function StatusBadge({ status }: { status: ChecklistItem['status'] }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready
      </span>
    );
  }
  if (status === 'placeholder') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Placeholder
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Missing
    </span>
  );
}

export default async function SetupPage() {
  const env = checkDeploymentEnv();
  const checklist = buildChecklist(env);

  return (
    <main className="min-h-dvh bg-background px-6 py-16 text-foreground">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-display tracking-tight">save2repo · Setup</h1>
          <p className="text-muted-foreground">
            This save2repo deployment needs three pieces of context before
            the dashboard can run. Complete the checklist below, then refresh
            this page.
          </p>
        </header>

        <ul className="space-y-4">
          {checklist.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold">{item.title}</h2>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              {item.action ? (
                <div className="mt-4">
                  <a
                    href={item.action.href}
                    target={item.action.external ? '_blank' : undefined}
                    rel={item.action.external ? 'noopener noreferrer' : undefined}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {item.action.label} →
                  </a>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <footer className="space-y-2 text-sm text-muted-foreground">
          <p>
            Documentation:{' '}
            <Link href="/" className="underline hover:text-foreground">
              save2repo home
            </Link>{' '}
            · check the &ldquo;Deploying the showcase&rdquo; section in the
            project README for the manual setup walkthrough.
          </p>
          <p className="text-xs">
            olonjs backend:{' '}
            <code className="font-mono">{env.olonjsApiBase}</code>
          </p>
        </footer>
      </div>
    </main>
  );
}
