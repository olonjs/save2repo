import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    resource: `${origin}/api/v1/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write", "submit-form"],
  });
}
