import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// ----------------------------------------------------------------------------
// save2repo Supabase clients.
//
// Build-time vs runtime contract:
//   - At BUILD time (Vercel + CI), `NEXT_PUBLIC_SUPABASE_*` may be missing or
//     placeholder values. We tolerate that with fallbacks so the static
//     analysis / module init don't blow up during `next build`.
//   - At RUNTIME, the deployment is expected to have real values injected by
//     the Supabase Vercel integration (see ADR-007). The first-boot setup
//     wizard (T-102) detects the placeholder state via `isSupabaseConfigured()`
//     and renders the "Add Supabase integration" UI before any auth call.
//   - For the admin client (server-only, service_role) we throw eagerly when
//     env vars are missing — the admin client is only used from server code
//     that requires real backend access; placeholder values would be a bug.
// ----------------------------------------------------------------------------

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

/** Browser client. May point at placeholder host at build time — UI code MUST
 *  guard auth calls behind `isSupabaseConfigured()`. */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

/** True when both browser-side env vars look like real Supabase values
 *  (host on `*.supabase.co` or custom, key longer than the placeholder sentinel). */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  if (url === PLACEHOLDER_URL || url.includes('placeholder.supabase')) return false;
  if (anonKey === PLACEHOLDER_KEY) return false;
  return true;
}

/** Server-side admin client (bypasses RLS). Throws immediately if env vars
 *  are missing — never run admin operations against placeholder values. */
export const getSupabaseAdmin = () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
};