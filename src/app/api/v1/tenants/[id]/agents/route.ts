import { NextRequest, NextResponse } from "next/server";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import {
  createTenantAgentCredential,
  listTenantAgentCredentials,
  normalizeScopes,
  type AgentCredentialScope,
} from "@/lib/mcpGatewayCredentials";
import { resolveCorrelationId } from "@/lib/correlation";

export const dynamic = "force-dynamic";

type CreateCredentialBody = {
  label?: string;
  scopes?: AgentCredentialScope[];
};

function serializeCredential(row: {
  id: string;
  tenant_id: string;
  client_id: string;
  label: string;
  scopes: AgentCredentialScope[];
  secret_hint: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    label: row.label,
    scopes: row.scopes,
    secretHint: row.secret_hint,
    createdBy: row.created_by,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
      credentials: credentials.map((credential) =>
        serializeCredential({
          id: credential.id,
          tenant_id: credential.tenant_id,
          client_id: credential.client_id,
          label: credential.label,
          scopes: credential.scopes,
          secret_hint: credential.secret_hint,
          created_by: credential.created_by,
          last_used_at: credential.last_used_at,
          revoked_at: credential.revoked_at,
          created_at: credential.created_at,
          updated_at: credential.updated_at,
        })
      ),
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
      createdBy: access.userId,
    });
    return NextResponse.json(
      {
        correlationId,
        tenantId: params.id,
        credential: serializeCredential({
          id: created.row.id,
          tenant_id: created.row.tenant_id,
          client_id: created.row.client_id,
          label: created.row.label,
          scopes: created.row.scopes,
          secret_hint: created.row.secret_hint,
          created_by: created.row.created_by,
          last_used_at: created.row.last_used_at,
          revoked_at: created.row.revoked_at,
          created_at: created.row.created_at,
          updated_at: created.row.updated_at,
        }),
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
