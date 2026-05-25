import { Buffer } from "buffer";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  resolveAgentCredentialByClientId,
  resolveAgentCredentialBySecret,
  touchAgentCredentialUsage,
  type AgentCredentialScope,
  type TenantAgentCredentialRow,
} from "@/lib/mcpGatewayCredentials";
import { verifyAccessToken } from "@/lib/mcpGatewayOAuth";

export type McpGatewayTenantContext = {
  credential: TenantAgentCredentialRow;
  tenant: {
    id: string;
    slug: string;
  };
  authMode: "oauth_access_token" | "legacy_secret";
};

function parseAuthorizationSecret(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const [scheme, rawToken] = authorizationHeader.split(" ");
  if (!scheme || !rawToken) return null;

  if (scheme.toLowerCase() === "bearer") {
    return rawToken.trim() || null;
  }

  if (scheme.toLowerCase() === "basic") {
    try {
      const decoded = Buffer.from(rawToken, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator === -1) return null;
      const secret = decoded.slice(separator + 1).trim();
      return secret || null;
    } catch {
      return null;
    }
  }

  return null;
}

function parseSecretFromHeaders(headers: Headers): string | null {
  const fromAuth = parseAuthorizationSecret(headers.get("authorization"));
  if (fromAuth) return fromAuth;
  const apiKeyHeader = headers.get("x-api-key")?.trim();
  if (apiKeyHeader) return apiKeyHeader;
  return null;
}

export function hasScope(scopes: AgentCredentialScope[], required: AgentCredentialScope): boolean {
  return scopes.includes(required);
}

export async function resolveMcpGatewayTenantContext(headers: Headers): Promise<McpGatewayTenantContext | null> {
  const secret = parseSecretFromHeaders(headers);
  if (!secret) {
    console.warn("[mcp-gateway-auth] no secret in headers");
    return null;
  }

  const accessTokenPayload = verifyAccessToken(secret);
  let credential: TenantAgentCredentialRow | null = null;
  let authMode: McpGatewayTenantContext["authMode"] = "legacy_secret";

  if (accessTokenPayload) {
    authMode = "oauth_access_token";
    const credentialFromClient = await resolveAgentCredentialByClientId(accessTokenPayload.clientId);
    if (credentialFromClient && credentialFromClient.id === accessTokenPayload.credentialId) {
      credential = credentialFromClient;
    } else {
      console.warn("[mcp-gateway-auth] access token credentialId mismatch", {
        tokenClientId: accessTokenPayload.clientId,
        tokenCredentialId: accessTokenPayload.credentialId,
        dbCredentialId: credentialFromClient?.id ?? null,
        dbTenantId: credentialFromClient?.tenant_id ?? null,
      });
    }
  } else {
    credential = await resolveAgentCredentialBySecret(secret);
  }

  if (!credential) {
    console.warn("[mcp-gateway-auth] credential not found", { authMode });
    return null;
  }

  // save2repo schema: tenants table has no `api_key` column (ADR-002 single-owner
  // + MCP credentials live in tenant_agent_credentials, scoped per credential
  // not per tenant). The "api_key" the consumer of this helper expects is now
  // the per-credential client_secret (already resolved via `credential` above);
  // we simply hand it back from credential.client_secret_hash → resolved upstream.
  // Tenant lookup keeps only the identity fields.
  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id,slug")
    .eq("id", credential.tenant_id)
    .maybeSingle<{ id: string; slug: string }>();
  if (error || !tenant?.id) {
    console.warn("[mcp-gateway-auth] tenant not found for credential", {
      credentialId: credential.id,
      credentialTenantId: credential.tenant_id,
      error: error?.message ?? null,
    });
    return null;
  }

  console.info("[mcp-gateway-auth] resolved", {
    authMode,
    credentialId: credential.id,
    credentialLabel: credential.label,
    clientId: credential.client_id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
  });

  if (!accessTokenPayload) {
    await touchAgentCredentialUsage(credential.id);
  }
  return { credential, tenant, authMode };
}
