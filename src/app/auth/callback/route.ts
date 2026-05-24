import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { ensureOwnerIntegrationsSeeded } from "@/lib/firstBoot";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const nextPath = next && next.startsWith("/") ? next : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.session?.user?.id) {
        // T-A06: at first login post-Marketplace-install, consume the seed
        // stashed by jsonpages-platform's install callback into
        // owner_integrations. Idempotent + non-fatal.
        try {
          await ensureOwnerIntegrationsSeeded(data.session.user.id);
        } catch (seedErr) {
          console.error(
            "[auth/callback] bootstrap seed failed (non-fatal):",
            seedErr,
          );
        }
      }
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
