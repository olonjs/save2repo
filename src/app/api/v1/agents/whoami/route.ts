import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  resolveAgentCredentialByClientId,
  verifyClientSecret,
} from "@/lib/mcpGatewayCredentials";
import { resolveCorrelationId } from "@/lib/correlation";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

type ClientCredentials = { clientId: string; clientSecret: string };

function parseBasicAuth(header: string | null): ClientCredentials | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
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

function parseQueryCredentials(url: URL): ClientCredentials | null {
  const clientId = url.searchParams.get("client_id")?.trim();
  const clientSecret = url.searchParams.get("client_secret")?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function parseBodyCredentials(req: NextRequest): Promise<ClientCredentials | null> {
  try {
    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as Partial<{ client_id: string; client_secret: string }>;
      const clientId = body?.client_id?.trim();
      const clientSecret = body?.client_secret?.trim();
      if (clientId && clientSecret) return { clientId, clientSecret };
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const clientId = params.get("client_id")?.trim();
      const clientSecret = params.get("client_secret")?.trim();
      if (clientId && clientSecret) return { clientId, clientSecret };
    }
  } catch {
    return null;
  }
  return null;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));

  const creds =
    parseBasicAuth(req.headers.get("authorization")) ||
    parseQueryCredentials(new URL(req.url)) ||
    (await parseBodyCredentials(req));

  if (!creds) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing credentials. Provide Basic auth, ?client_id=&client_secret=, or JSON body.",
        correlationId,
      },
      { status: 400, headers: corsHeaders }
    );
  }

  const credential = await resolveAgentCredentialByClientId(creds.clientId);
  if (!credential) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_client: no active credential for client_id",
        clientIdProvided: creds.clientId,
        correlationId,
      },
      { status: 401, headers: corsHeaders }
    );
  }

  if (!verifyClientSecret(credential, creds.clientSecret)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_client: client_secret does not match",
        clientIdProvided: creds.clientId,
        credentialIdMatched: credential.id,
        correlationId,
      },
      { status: 401, headers: corsHeaders }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id,slug,display_name,owner_user_id,created_at")
    .eq("id", credential.tenant_id)
    .maybeSingle<{ id: string; slug: string; display_name: string | null; owner_user_id: string; created_at: string }>();

  return NextResponse.json(
    {
      ok: true,
      correlationId,
      credential: {
        id: credential.id,
        clientId: credential.client_id,
        label: credential.label,
        scopes: credential.scopes,
        tenantId: credential.tenant_id,
        revokedAt: credential.revoked_at,
        createdAt: credential.created_at,
        lastUsedAt: credential.last_used_at,
      },
      tenant: tenantError
        ? { error: tenantError.message }
        : tenant
          ? {
              id: tenant.id,
              slug: tenant.slug,
              name: tenant.display_name ?? tenant.slug,
              ownerId: tenant.owner_user_id,
              createdAt: tenant.created_at,
            }
          : null,
    },
    { headers: corsHeaders }
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
