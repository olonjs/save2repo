import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

export type TenantContentPayload = {
  siteConfig: unknown | null;
  pages: Record<string, unknown>;
};

type TenantContentRow = {
  tenant_id: string;
  environment: string;
  content_jsonb: TenantContentPayload;
  content_version: number;
  checksum: string | null;
  size_bytes: number;
  updated_at: string;
  updated_by: string | null;
};

const DEFAULT_ENV = "production";

export function tenantNamespaceFromId(tenantId: string): string {
  return `t_${tenantId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40)}`;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "") || "home";
}

function sanitizePayload(input: TenantContentPayload): TenantContentPayload {
  return {
    siteConfig: input.siteConfig ?? null,
    pages: typeof input.pages === "object" && input.pages !== null ? input.pages : {},
  };
}

function computeChecksum(content: TenantContentPayload): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function computeSizeBytes(content: TenantContentPayload): number {
  return Buffer.byteLength(JSON.stringify(content), "utf8");
}

async function upsertRow(params: {
  tenantId: string;
  environment?: string;
  payload: TenantContentPayload;
  updatedBy?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const environment = params.environment ?? DEFAULT_ENV;
  const payload = sanitizePayload(params.payload);
  const checksum = computeChecksum(payload);
  const sizeBytes = computeSizeBytes(payload);
  const nowIso = new Date().toISOString();

  const { error } = await supabaseAdmin.from("tenant_content_store").upsert(
    {
      tenant_id: params.tenantId,
      environment,
      content_jsonb: payload,
      checksum,
      size_bytes: sizeBytes,
      updated_at: nowIso,
      updated_by: params.updatedBy ?? null,
      content_version: 1,
    },
    { onConflict: "tenant_id,environment" }
  );
  if (error) throw new Error(`Failed to upsert tenant content: ${error.message}`);
}

export async function readTenantContent(tenantId: string, environment = DEFAULT_ENV): Promise<TenantContentPayload | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_content_store")
    .select("tenant_id,environment,content_jsonb,content_version,checksum,size_bytes,updated_at,updated_by")
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .maybeSingle<TenantContentRow>();
  if (error) throw new Error(`Failed to read tenant content: ${error.message}`);
  if (!data?.content_jsonb) return null;
  return sanitizePayload(data.content_jsonb);
}

export async function replaceTenantContent(
  tenantId: string,
  payload: TenantContentPayload,
  options?: { environment?: string; updatedBy?: string | null }
) {
  await upsertRow({
    tenantId,
    environment: options?.environment,
    payload,
    updatedBy: options?.updatedBy,
  });
}

export async function upsertTenantPage(
  tenantId: string,
  slug: string,
  pagePayload: unknown,
  options?: { environment?: string; updatedBy?: string | null }
) {
  const current = (await readTenantContent(tenantId, options?.environment)) ?? { siteConfig: null, pages: {} };
  const nextSlug = normalizeSlug(slug);
  const next: TenantContentPayload = {
    siteConfig: current.siteConfig ?? null,
    pages: { ...current.pages, [nextSlug]: pagePayload },
  };
  await upsertRow({
    tenantId,
    environment: options?.environment,
    payload: next,
    updatedBy: options?.updatedBy,
  });
}

export async function upsertTenantSiteConfig(
  tenantId: string,
  siteConfigPayload: unknown,
  options?: { environment?: string; updatedBy?: string | null }
) {
  const current = (await readTenantContent(tenantId, options?.environment)) ?? { siteConfig: null, pages: {} };
  const next: TenantContentPayload = {
    siteConfig: siteConfigPayload ?? null,
    pages: { ...current.pages },
  };
  await upsertRow({
    tenantId,
    environment: options?.environment,
    payload: next,
    updatedBy: options?.updatedBy,
  });
}
