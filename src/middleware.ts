import { NextResponse, type NextRequest } from 'next/server';
import { checkDeploymentEnv } from '@/lib/firstBoot';
import { updateSupabaseSession } from '@/lib/supabaseMiddleware';

// Paths that bypass the first-boot setup gate. The /setup wizard itself must
// always be reachable, and static assets / API endpoints (used during install
// and by the olonjs backend) must not be intercepted.
const SETUP_BYPASS_PREFIXES = ['/setup', '/api/', '/_next/', '/favicon', '/eula', '/privacy', '/.well-known'];

function shouldBypassSetupGate(pathname: string): boolean {
  return SETUP_BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // First-boot setup gate: if the deployment is not configured yet, send the
  // owner to /setup with a clear checklist instead of letting the app crash
  // on the first Supabase or olonjs-backend call.
  if (!shouldBypassSetupGate(pathname)) {
    const env = checkDeploymentEnv();
    if (!env.ok) {
      const setupUrl = new URL('/setup', req.url);
      return NextResponse.redirect(setupUrl);
    }
  }

  // When fully configured, run the standard Supabase session refresh so the
  // request handler can read auth.getUser() with fresh cookies.
  return updateSupabaseSession(req);
}

export const config = {
  // Skip middleware on static files. The matcher mirrors the Next.js docs
  // recommendation, minus the explicit /api skip (we want /api/v1/* through
  // updateSupabaseSession when configured).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
