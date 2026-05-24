import { getSupabaseAdmin } from "@/lib/supabase";

// ----------------------------------------------------------------------------
// Per-owner Vercel credentials helper.
//
// save2repo is single-owner (ADR-002): the buyer's Vercel access token +
// team_id live in `owner_integrations`, seeded at install time by T-A06 and
// refreshed via /settings/integrations when the token expires (T-103).
// Routes that hit the Vercel API (domains, deploy, env) read here instead of
// the parent's centralized `VERCEL_AUTH_TOKEN` env var.
// ----------------------------------------------------------------------------

export type OwnerVercelCreds = {
  token: string;
  teamId: string;
};

type OwnerIntegrationsRow = {
  vercel_oauth_token: string | null;
  vercel_team_id: string | null;
};

export class OwnerVercelCredsMissingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OwnerVercelCredsMissingError";
  }
}

/**
 * Resolve the owner's Vercel credentials by userId. Throws
 * OwnerVercelCredsMissingError when missing — the caller maps to a 409 with
 * the same code so the dashboard can guide the owner back to
 * /settings/integrations.
 */
export async function getOwnerVercelCreds(userId: string): Promise<OwnerVercelCreds> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("owner_integrations")
    .select("vercel_oauth_token, vercel_team_id")
    .eq("owner_user_id", userId)
    .maybeSingle<OwnerIntegrationsRow>();
  if (error) {
    throw new OwnerVercelCredsMissingError(
      "ERR_OWNER_VERCEL_LOOKUP_FAILED",
      `owner_integrations lookup failed: ${error.message}`,
    );
  }
  if (!data?.vercel_oauth_token || !data.vercel_team_id) {
    throw new OwnerVercelCredsMissingError(
      "ERR_OWNER_VERCEL_NOT_CONNECTED",
      "Vercel is not connected for this owner; visit /settings/integrations",
    );
  }
  return { token: data.vercel_oauth_token, teamId: data.vercel_team_id };
}
