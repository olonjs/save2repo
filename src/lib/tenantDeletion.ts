import { del, list } from "@vercel/blob";
import { deleteZone, type CloudflareApiError } from "@/lib/cloudflareApi";
import { getSupabaseAdmin } from "@/lib/supabase";

export type TenantBlobCleanupPrefixResult = {
  prefix: string;
  deletedCount: number;
};

export type TenantBlobCleanupResult = {
  tokenSource: "BLOB_READ_WRITE_TOKEN" | "JSONPAGES_READ_WRITE_TOKEN";
  prefixes: TenantBlobCleanupPrefixResult[];
  deletedCount: number;
};

function resolveBlobToken(): { token: string; source: TenantBlobCleanupResult["tokenSource"] } {
  const primary = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (primary) return { token: primary, source: "BLOB_READ_WRITE_TOKEN" };
  const fallback = process.env.JSONPAGES_READ_WRITE_TOKEN?.trim();
  if (fallback) return { token: fallback, source: "JSONPAGES_READ_WRITE_TOKEN" };
  throw new Error("Blob token missing: set BLOB_READ_WRITE_TOKEN or JSONPAGES_READ_WRITE_TOKEN");
}

async function deleteByPrefix(prefix: string, token: string): Promise<TenantBlobCleanupPrefixResult> {
  let cursor: string | undefined;
  let deletedCount = 0;

  do {
    const page = await list({ prefix, token, cursor, limit: 100 });
    const targets = page.blobs
      .map((blob) => blob.url || blob.pathname)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (targets.length > 0) {
      await del(targets, { token });
      deletedCount += targets.length;
    }
    cursor = page.hasMore ? (page.cursor ?? undefined) : undefined;
  } while (cursor);

  return { prefix, deletedCount };
}

export async function deleteTenantBlobFolders(tenantId: string, tenantSlug: string): Promise<TenantBlobCleanupResult> {
  const { token, source } = resolveBlobToken();
  const prefixes = [`tenant-assets/${tenantId}/`, `tenant-previews/${tenantId}/`, `tenants/${tenantSlug}/`];
  const results: TenantBlobCleanupPrefixResult[] = [];
  for (const prefix of prefixes) {
    results.push(await deleteByPrefix(prefix, token));
  }
  return {
    tokenSource: source,
    prefixes: results,
    deletedCount: results.reduce((acc, entry) => acc + entry.deletedCount, 0),
  };
}

export type TenantCloudflareCleanupResult = {
  attempted: number;
  deleted: number;
  alreadyMissing: number;
  skippedShared: number;
  failed: Array<{ zoneId: string; domain: string; code: string; message: string }>;
};

export async function deleteTenantCloudflareZones(tenantId: string): Promise<TenantCloudflareCleanupResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenant_domains")
    .select("id, domain, cf_zone_id")
    .eq("tenant_id", tenantId)
    .not("cf_zone_id", "is", null);

  if (error) {
    throw new Error(`ERR_CF_CLEANUP_LOOKUP_FAILED: ${error.message}`);
  }

  const result: TenantCloudflareCleanupResult = {
    attempted: 0,
    deleted: 0,
    alreadyMissing: 0,
    skippedShared: 0,
    failed: [],
  };

  for (const row of data ?? []) {
    const zoneId = row.cf_zone_id as string | null;
    if (!zoneId) continue;
    result.attempted += 1;

    // Shared-zone protection: if any other live tenant_domain (different tenant_id)
    // also points at this zone, do NOT delete the zone on Cloudflare.
    const { count: sharedCount, error: sharedError } = await supabase
      .from("tenant_domains")
      .select("id", { head: true, count: "exact" })
      .eq("cf_zone_id", zoneId)
      .neq("tenant_id", tenantId)
      .is("deleted_at", null);

    if (sharedError) {
      result.failed.push({
        zoneId,
        domain: String(row.domain ?? ""),
        code: "ERR_CF_CLEANUP_SHARED_LOOKUP_FAILED",
        message: sharedError.message,
      });
      continue;
    }

    if ((sharedCount ?? 0) > 0) {
      result.skippedShared += 1;
      continue;
    }

    try {
      await deleteZone(zoneId);
      result.deleted += 1;
    } catch (err: unknown) {
      const cfErr = (typeof err === "object" && err !== null
        ? (err as Partial<CloudflareApiError>)
        : {}) as Partial<CloudflareApiError>;
      if (cfErr.code === "ERR_CF_NOT_FOUND") {
        result.alreadyMissing += 1;
        continue;
      }
      result.failed.push({
        zoneId,
        domain: String(row.domain ?? ""),
        code: String(cfErr.code ?? "ERR_CF_DELETE_FAILED"),
        message: String(cfErr.message ?? "Cloudflare zone delete failed"),
      });
    }
  }

  return result;
}
