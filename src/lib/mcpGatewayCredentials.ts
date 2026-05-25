import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TenantAgentCredentialRow as DbTenantAgentCredentialRow } from "@/types/database";

// ----------------------------------------------------------------------------
// MCP gateway credentials (T-006.b alignment).
//
// DB is the SOT: save2repo schema for `tenant_agent_credentials` is leaner
// than the parent jsonpages-platform variant. Specifically:
//
//   parent column  → save2repo column / fate
//   ──────────────────────────────────────────────────────────────
//   label          → display_name
//   secret_hash    → client_secret_hash
//   secret_hint    → DROPPED (single-owner, fingerprint not needed)
//   created_by     → DROPPED (single-owner = one possible creator)
//   updated_at     → DROPPED (created_at is enough for this table)
//
// The internal lib type mirrors the DB; the API/UI layer (agents/route.ts +
// AgentsPanel) keeps the parent-friendly `label` and adds a synthetic
// `secret_hint` derived from client_id so the AgentsPanel renders without
// modification.
// ----------------------------------------------------------------------------

export type AgentCredentialScope = "read" | "write" | "submit-form";

/** Internal row shape — matches the DB SOT 1:1. */
export type TenantAgentCredentialRow = DbTenantAgentCredentialRow & {
  scopes: AgentCredentialScope[];
};

const ALLOWED_SCOPES: AgentCredentialScope[] = ["read", "write", "submit-form"];

export function normalizeScopes(input: unknown): AgentCredentialScope[] {
  if (!Array.isArray(input) || input.length === 0) return ["read", "write"];
  const normalized = Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is AgentCredentialScope => ALLOWED_SCOPES.includes(value as AgentCredentialScope))
    )
  );
  return normalized.length > 0 ? normalized : ["read", "write"];
}

export function hashAgentSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateAgentSecret(): string {
  return `olon_sk_${randomBytes(32).toString("base64url")}`;
}

export function generateAgentClientId(): string {
  return `olon_client_${randomBytes(10).toString("hex")}`;
}

const SELECT_COLUMNS =
  "id,tenant_id,client_id,display_name,scopes,client_secret_hash,last_used_at,revoked_at,created_at";

export async function createTenantAgentCredential(params: {
  tenantId: string;
  label: string;
  scopes: AgentCredentialScope[];
}): Promise<{ row: TenantAgentCredentialRow; clientId: string; clientSecret: string }> {
  const secret = generateAgentSecret();
  const secretHash = hashAgentSecret(secret);
  const clientId = generateAgentClientId();
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .insert({
      tenant_id: params.tenantId,
      client_id: clientId,
      display_name: params.label,
      scopes: params.scopes,
      client_secret_hash: secretHash,
    })
    .select(SELECT_COLUMNS)
    .single<TenantAgentCredentialRow>();

  if (error || !data) {
    throw new Error(`Failed to create agent credential: ${error?.message ?? "unknown error"}`);
  }
  return { row: data, clientId, clientSecret: secret };
}

export async function listTenantAgentCredentials(tenantId: string): Promise<TenantAgentCredentialRow[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .returns<TenantAgentCredentialRow[]>();
  if (error) throw new Error(`Failed to list agent credentials: ${error.message}`);
  return data ?? [];
}

export async function revokeTenantAgentCredential(params: {
  tenantId: string;
  credentialId: string;
}): Promise<TenantAgentCredentialRow | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .update({ revoked_at: nowIso })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.credentialId)
    .is("revoked_at", null)
    .select(SELECT_COLUMNS)
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to revoke agent credential: ${error.message}`);
  return data ?? null;
}

export async function resolveAgentCredentialBySecret(secret: string): Promise<TenantAgentCredentialRow | null> {
  const secretHash = hashAgentSecret(secret);
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .select(SELECT_COLUMNS)
    .eq("client_secret_hash", secretHash)
    .is("revoked_at", null)
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to resolve agent credential: ${error.message}`);
  return data ?? null;
}

export async function resolveAgentCredentialByClientId(clientId: string): Promise<TenantAgentCredentialRow | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .select(SELECT_COLUMNS)
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to resolve agent credential by client_id: ${error.message}`);
  return data ?? null;
}

export function verifyClientSecret(credential: TenantAgentCredentialRow, clientSecret: string): boolean {
  return credential.client_secret_hash === hashAgentSecret(clientSecret);
}

export async function touchAgentCredentialUsage(credentialId: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .update({ last_used_at: nowIso })
    .eq("id", credentialId);
  if (error) throw new Error(`Failed to update agent credential usage: ${error.message}`);
}

/**
 * UI-facing serializer: maps the DB row to the API contract the AgentsPanel
 * expects (parent-style `label` + synthetic `secret_hint` derived from
 * client_id since save2repo no longer stores the secret hint column).
 */
export function serializeCredentialForApi(row: TenantAgentCredentialRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    label: row.display_name ?? "",
    scopes: row.scopes,
    // Synthetic hint: last 6 chars of client_id (the secret itself is never
    // re-readable after creation; the hint here is purely a row-identifying
    // fingerprint visible in the AgentsPanel table).
    secretHint: `…${row.client_id.slice(-6)}`,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
