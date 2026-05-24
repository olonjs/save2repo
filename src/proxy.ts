import { NextResponse, type NextRequest } from 'next/server';
import { checkDeploymentEnv } from '@/lib/firstBoot';
import { updateSupabaseSession } from '@/lib/supabaseMiddleware';

// Paths that bypass the first-boot setup gate. The /setup wizard itself must
// always be reachable, and static assets / API endpoints (used during install
// and by the olonjs backend) must not be intercepted.
const SETUP_BYPASS_PREFIXES = [
  '/setup',
  '/api/',
  '/_next/',
  '/favicon',
  '/eula',
  '/privacy',
  '/.well-known',
];

function shouldBypassSetupGate(pathname: string): boolean {
  return SETUP_BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

// Next.js 16 renamed `middleware.ts` to `proxy.ts` — this file fulfils both
// roles: first-boot setup gate (T-102) and Supabase session refresh
// (inherited from jsonpages-platform).
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // First-boot setup gate: if the deployment is not configured yet, send the
  // owner to /setup with a clear checklist instead of letting the app crash
  // on the first Supabase or olonjs-backend call.
  if (!shouldBypassSetupGate(pathname)) {
    const env = checkDeploymentEnv();
    if (!env.ok) {
      const setupUrl = new URL('/setup', request.url);
      return NextResponse.redirect(setupUrl);
    }
  }

  // When fully configured, run the standard Supabase session refresh so the
  // request handler can read auth.getUser() with fresh cookies.
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
