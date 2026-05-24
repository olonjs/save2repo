'use client';

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const GitHubIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.36 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.64 1.03 2.76 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.28 10.28 0 0 0 22 12.23C22 6.58 17.52 2 12 2z" />
  </svg>
);

export default function Login({ nextPath }: { nextPath?: string }) {
  const configured = isSupabaseConfigured();
  const safeNextPath =
    nextPath && nextPath.startsWith('/') ? nextPath : '/dashboard';

  const handleGitHubLogin = async () => {
    if (!configured) return;
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath)}`,
      },
    });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-display tracking-tight">save2repo</h1>
          <p className="text-sm text-muted-foreground">
            A CMS that lives in your GitHub repos. Sign in to manage your tenants.
          </p>
        </header>

        {!configured ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500"
                aria-hidden="true"
              />
              <div className="space-y-2">
                <p className="font-medium text-foreground">Setup incomplete</p>
                <p className="text-muted-foreground">
                  Supabase environment variables are missing on this deployment.
                  Add the Supabase Marketplace integration to your Vercel team
                  to continue.
                </p>
                <a
                  href="https://vercel.com/integrations/supabase/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-medium text-amber-600 underline hover:text-amber-700"
                >
                  Install Supabase integration →
                </a>
              </div>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={handleGitHubLogin}
          >
            <GitHubIcon />
            Continue with GitHub
          </Button>
        )}

        <footer className="text-center text-xs text-muted-foreground">
          By continuing you agree to the{' '}
          <Link href="/eula" className="underline hover:text-foreground">
            license terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            privacy policy
          </Link>
          .
        </footer>
      </div>
    </main>
  );
}
