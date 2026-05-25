import { NextRequest, NextResponse } from "next/server";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import {
  createTenantAgentCredential,
  listTenantAgentCredentials,
  normalizeScopes,
  serializeCredentialForApi,
  type AgentCredentialScope,
} from "@/lib/mcpGatewayCredentials";
import { resolveCorrelationId } from "@/lib/correlation";

export const dynamic = "force-dynamic";

type CreateCredentialBody = {
  label?: string;
  scopes?: AgentCredentialScope[];
};

async function ensureAccess(req: NextRequest, tenantId: string, correlationId: string) {
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return { ok: false as const, response: NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status }) };
  }

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId,
    requiredRole: "admin",
  });
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.data.error, code: access.data.code, correlationId }, { status: access.data.status }),
    };
  }

  return { ok: true as const, userId: auth.data.user.id };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const access = await ensureAccess(req, params.id, correlationId);
  if (!access.ok) return access.response;

  try {
    const credentials = await listTenantAgentCredentials(params.id);
    return NextResponse.json({
      correlationId,
      tenantId: params.id,
      credentials: credentials.map(serializeCredentialForApi),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list agent credentials";
    return NextResponse.json({ error: message, code: "ERR_AGENT_CREDENTIALS_LIST_FAILED", correlationId }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const access = await ensureAccess(req, params.id, correlationId);
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as CreateCredentialBody;
  const label = (body.label ?? "").trim() || "Claude connector";
  const scopes = normalizeScopes(body.scopes);

  try {
    const created = await createTenantAgentCredential({
      tenantId: params.id,
      label,
      scopes,
    });
    return NextResponse.json(
      {
        correlationId,
        tenantId: params.id,
        credential: serializeCredentialForApi(created.row),
        clientId: created.clientId,
        clientSecret: created.clientSecret,
        secret: created.clientSecret,
        note: "Client secret is shown only once. Store it securely.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create agent credential";
    return NextResponse.json({ error: message, code: "ERR_AGENT_CREDENTIAL_CREATE_FAILED", correlationId }, { status: 500 });
  }
}
