import { getSupabaseAdmin } from "@/lib/supabase";

// ----------------------------------------------------------------------------
// Shared tenant repo context resolver.
//
// Joins tenants (github_owner_login + github_repo_name) with owner_integrations
// (github_installation_id via owner_user_id) to produce the {owner, repo,
// installationId} triplet that MCP/A2A handlers + the forms-submit route all
// need to call the GitHub Contents API via githubAppClient.
//
// Returns a discriminated union so call sites can map errors to their wire
// format (JSON-RPC code for MCP/A2A, HTTP status for routes).
// ----------------------------------------------------------------------------

export type TenantRepoContext =
  | { ok: true; owner: string; repo: string; installationId: number }
  | { ok: false; error: string; code: string };

export async function resolveTenantRepoContext(tenantId: string): Promise<TenantRepoContext> {
  const supabase = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("github_owner_login, github_repo_name, owner_user_id")
    .eq("id", tenantId)
    .maybeSingle<{
      github_owner_login: string | null;
      github_repo_name: string | null;
      owner_user_id: string;
    }>();
  if (tenantErr) {
    return { ok: false, error: tenantErr.message, code: "ERR_TENANT_LOOKUP" };
  }
  if (!tenant?.github_owner_login || !tenant.github_repo_name) {
    return {
      ok: false,
      error: "Tenant has no GitHub repo (provisioning incomplete)",
      code: "ERR_TENANT_NO_REPO",
    };
  }
  const { data: integ, error: integErr } = await supabase
    .from("owner_integrations")
    .select("github_installation_id")
    .eq("owner_user_id", tenant.owner_user_id)
    .maybeSingle<{ github_installation_id: number | null }>();
  if (integErr) {
    return { ok: false, error: integErr.message, code: "ERR_INTEGRATIONS_LOOKUP" };
  }
  if (!integ?.github_installation_id) {
    return {
      ok: false,
      error: "GitHub App installation_id missing on owner_integrations",
      code: "ERR_GITHUB_NOT_INSTALLED",
    };
  }
  return {
    ok: true,
    owner: tenant.github_owner_login,
    repo: tenant.github_repo_name,
    installationId: integ.github_installation_id,
  };
}
