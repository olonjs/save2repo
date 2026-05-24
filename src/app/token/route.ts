import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { createAccessToken, verifyAuthorizationCode, verifyPkce } from "@/lib/mcpGatewayOAuth";
import { resolveAgentCredentialByClientId, verifyClientSecret } from "@/lib/mcpGatewayCredentials";

export const dynamic = "force-dynamic";

function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function parseBasicClientCredentials(authorizationHeader: string | null): { clientId: string; clientSecret: string } | null {
  if (!authorizationHeader) return null;
  const [scheme, value] = authorizationHeader.split(" ");
  if (!scheme || !value || scheme.toLowerCase() !== "basic") return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    const clientId = decoded.slice(0, separator).trim();
    const clientSecret = decoded.slice(separator + 1).trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

function normalizeRedirectUri(input: string): string {
  try {
    const url = new URL(input);
    const pathname = url.pathname.endsWith("/") && url.pathname !== "/" ? url.pathname.slice(0, -1) : url.pathname;
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return input.trim();
  }
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_request", error_description: "Expected form-urlencoded body" }, { status: 400 });
  }

  const rawBody = await req.text();
  const form = parseForm(rawBody);
  const grantType = form.grant_type ?? "";
  const code = form.code ?? "";
  const redirectUriRaw = form.redirect_uri ?? "";
  const basic = parseBasicClientCredentials(req.headers.get("authorization"));
  const clientId = form.client_id ?? basic?.clientId ?? "";
  const clientSecret = form.client_secret ?? basic?.clientSecret ?? "";
  const codeVerifier = form.code_verifier ?? "";

  if (grantType !== "authorization_code" || !code || !clientId || !clientSecret || !codeVerifier) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Missing one of required fields: grant_type, code, client_id, client_secret, code_verifier",
      },
      { status: 400 }
    );
  }

  const credential = await resolveAgentCredentialByClientId(clientId);
  if (!credential || !verifyClientSecret(credential, clientSecret)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const codePayload = verifyAuthorizationCode(code);
  if (!codePayload) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Authorization code is invalid or expired" },
      { status: 400 }
    );
  }
  const effectiveRedirectUri = redirectUriRaw || codePayload.redirectUri;
  const normalizedIncomingRedirect = normalizeRedirectUri(effectiveRedirectUri);
  const normalizedCodeRedirect = normalizeRedirectUri(codePayload.redirectUri);
  if (
    codePayload.clientId !== clientId ||
    codePayload.credentialId !== credential.id ||
    normalizedIncomingRedirect !== normalizedCodeRedirect
  ) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Code does not match client or redirect_uri" },
      { status: 400 }
    );
  }
  if (!verifyPkce({ codeVerifier, expectedChallenge: codePayload.codeChallenge })) {
    return NextResponse.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
  }

  const token = createAccessToken({
    userId: codePayload.sub,
    clientId: codePayload.clientId,
    credentialId: codePayload.credentialId,
    tenantId: codePayload.tenantId,
    scopes: codePayload.scopes,
  });

  return NextResponse.json({
    access_token: token.accessToken,
    token_type: "Bearer",
    expires_in: token.expiresIn,
    scope: codePayload.scopes.join(" "),
  });
}
