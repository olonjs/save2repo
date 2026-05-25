import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createAuthorizationCode, isAllowedOAuthRedirectUri } from "@/lib/mcpGatewayOAuth";
import { resolveAgentCredentialByClientId } from "@/lib/mcpGatewayCredentials";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const responseType = requestUrl.searchParams.get("response_type");
  const clientId = requestUrl.searchParams.get("client_id")?.trim() ?? "";
  const redirectUri = requestUrl.searchParams.get("redirect_uri")?.trim() ?? "";
  const codeChallenge = requestUrl.searchParams.get("code_challenge")?.trim() ?? "";
  const codeChallengeMethod = requestUrl.searchParams.get("code_challenge_method")?.trim() ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";

  if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing or invalid OAuth authorize parameters" },
      { status: 400 }
    );
  }

  if (!isAllowedOAuthRedirectUri(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri is not allowed" },
      { status: 400 }
    );
  }

  const credential = await resolveAgentCredentialByClientId(clientId);
  if (!credential) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_error", error_description: "Supabase auth not configured" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const nextPath = `${requestUrl.pathname}${requestUrl.search}`;
    const loginUrl = new URL("/", requestUrl.origin);
    loginUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(loginUrl);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id,owner_user_id")
    .eq("id", credential.tenant_id)
    .maybeSingle<{ id: string; owner_user_id: string }>();
  if (tenantError || !tenant?.id) {
    return NextResponse.json({ error: "invalid_client", error_description: "tenant not found for client" }, { status: 401 });
  }
  if (tenant.owner_user_id !== user.id) {
    return NextResponse.json({ error: "access_denied", error_description: "user cannot authorize this tenant client" }, { status: 403 });
  }

  const code = createAuthorizationCode({
    userId: user.id,
    clientId: credential.client_id,
    credentialId: credential.id,
    tenantId: credential.tenant_id,
    scopes: credential.scopes,
    redirectUri,
    codeChallenge,
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return NextResponse.redirect(redirect);
}
