import { del, list } from "@vercel/blob";
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

// save2repo (ADR-008): no Cloudflare-specific orchestration. Custom domains are
// managed via Vercel domains API only; DNS zone management is the buyer's
// responsibility on whatever registrar/provider they use. Reintroduce
// Cloudflare zone cleanup as a post-launch feature if/when needed.
