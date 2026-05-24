import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

export type AgentCredentialScope = "read" | "write" | "submit-form";

export type TenantAgentCredentialRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  label: string;
  scopes: AgentCredentialScope[];
  secret_hash: string;
  secret_hint: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
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

function buildSecretHint(secret: string): string {
  return `...${secret.slice(-6)}`;
}

export async function createTenantAgentCredential(params: {
  tenantId: string;
  label: string;
  scopes: AgentCredentialScope[];
  createdBy: string;
}): Promise<{ row: TenantAgentCredentialRow; clientId: string; clientSecret: string }> {
  const secret = generateAgentSecret();
  const secretHash = hashAgentSecret(secret);
  const secretHint = buildSecretHint(secret);
  const clientId = generateAgentClientId();
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .insert({
      tenant_id: params.tenantId,
      client_id: clientId,
      label: params.label,
      scopes: params.scopes,
      secret_hash: secretHash,
      secret_hint: secretHint,
      created_by: params.createdBy,
    })
    .select("id,tenant_id,client_id,label,scopes,secret_hash,secret_hint,created_by,last_used_at,revoked_at,created_at,updated_at")
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
    .select("id,tenant_id,client_id,label,scopes,secret_hash,secret_hint,created_by,last_used_at,revoked_at,created_at,updated_at")
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
    .update({
      revoked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.credentialId)
    .is("revoked_at", null)
    .select("id,tenant_id,client_id,label,scopes,secret_hash,secret_hint,created_by,last_used_at,revoked_at,created_at,updated_at")
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to revoke agent credential: ${error.message}`);
  return data ?? null;
}

export async function resolveAgentCredentialBySecret(secret: string): Promise<TenantAgentCredentialRow | null> {
  const secretHash = hashAgentSecret(secret);
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .select("id,tenant_id,client_id,label,scopes,secret_hash,secret_hint,created_by,last_used_at,revoked_at,created_at,updated_at")
    .eq("secret_hash", secretHash)
    .is("revoked_at", null)
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to resolve agent credential: ${error.message}`);
  return data ?? null;
}

export async function resolveAgentCredentialByClientId(clientId: string): Promise<TenantAgentCredentialRow | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .select("id,tenant_id,client_id,label,scopes,secret_hash,secret_hint,created_by,last_used_at,revoked_at,created_at,updated_at")
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .maybeSingle<TenantAgentCredentialRow>();
  if (error) throw new Error(`Failed to resolve agent credential by client_id: ${error.message}`);
  return data ?? null;
}

export function verifyClientSecret(credential: TenantAgentCredentialRow, clientSecret: string): boolean {
  return credential.secret_hash === hashAgentSecret(clientSecret);
}

export async function touchAgentCredentialUsage(credentialId: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("tenant_agent_credentials")
    .update({ last_used_at: nowIso, updated_at: nowIso })
    .eq("id", credentialId);
  if (error) throw new Error(`Failed to update agent credential usage: ${error.message}`);
}
