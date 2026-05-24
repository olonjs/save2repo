import type { TenantContentPayload } from "@/lib/tenantContentStore";

function sanitizeSlug(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-z0-9_-]/g, "-"))
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/") || "home";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Align with Edge→repo mapping: drop hot-save metadata before writing JSON to Git. */
function stripHotMetadata(value: unknown): unknown {
  if (!isObjectRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  delete next.t_page_id;
  delete next.t_config_id;
  delete next.tenant_id;
  return next;
}

/**
 * Maps Supabase tenant content store payload to repository JSON paths
 * (same layout as HotSave snapshot / Edge cold sync).
 */
export function tenantContentPayloadToRepoFiles(payload: TenantContentPayload): Array<{ path: string; content: unknown }> {
  const files: Array<{ path: string; content: unknown }> = [];
  if (payload.siteConfig != null) {
    files.push({ path: "src/data/config/site.json", content: stripHotMetadata(payload.siteConfig) });
  }
  for (const [rawSlug, page] of Object.entries(payload.pages ?? {})) {
    const slug = sanitizeSlug(rawSlug);
    if (!slug) continue;
    files.push({ path: `src/data/pages/${slug}.json`, content: stripHotMetadata(page) });
  }
  return files;
}
