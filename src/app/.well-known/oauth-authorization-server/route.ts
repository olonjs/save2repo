import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["read", "write", "submit-form"],
  });
}
