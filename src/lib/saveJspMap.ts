type EdgeItem = { key: string; value: unknown };
type TenantContent = {
  siteConfig?: unknown;
  pages: Record<string, unknown>;
};

function sanitizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripHotMetadata(value: unknown): unknown {
  if (!isObjectRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  delete next.t_page_id;
  delete next.t_config_id;
  delete next.tenant_id;
  return next;
}

export function edgeItemsToRepoFiles(items: EdgeItem[]): Array<{ path: string; content: unknown }> {
  return edgeItemsToRepoFilesForNamespace(items);
}

function stripPrefix(input: string, prefix: string): string | null {
  return input.startsWith(prefix) ? input.slice(prefix.length) : null;
}

export function edgeItemsToRepoFilesForNamespace(
  items: EdgeItem[],
  namespace?: string
): Array<{ path: string; content: unknown }> {
  const output: Array<{ path: string; content: unknown }> = [];
  const nsPrefix = namespace ? `${namespace}_` : null;
  for (const item of items) {
    let localKey = item.key;
    if (nsPrefix) {
      const stripped = stripPrefix(item.key, nsPrefix);
      if (!stripped) continue;
      localKey = stripped;
    }

    if (localKey === "config_site" || localKey === "config:site") {
      output.push({ path: "src/data/config/site.json", content: stripHotMetadata(item.value) });
      continue;
    }
    if (localKey.startsWith("page_") || localKey.startsWith("page:")) {
      const rawSlug = localKey.startsWith("page_")
        ? localKey.slice("page_".length)
        : localKey.slice("page:".length);
      const slug = sanitizeSlug(rawSlug);
      if (!slug) continue;
      output.push({ path: `src/data/pages/${slug}.json`, content: stripHotMetadata(item.value) });
    }
  }
  return output;
}

export function edgeItemsToTenantContentForNamespace(
  items: EdgeItem[],
  namespace?: string
): TenantContent {
  const pages: Record<string, unknown> = {};
  const nsPrefix = namespace ? `${namespace}_` : null;
  let siteConfig: unknown;

  for (const item of items) {
    let localKey = item.key;
    if (nsPrefix) {
      const stripped = stripPrefix(item.key, nsPrefix);
      if (!stripped) continue;
      localKey = stripped;
    }

    if (localKey === "config_site" || localKey === "config:site") {
      siteConfig = stripHotMetadata(item.value);
      continue;
    }

    if (localKey.startsWith("page_") || localKey.startsWith("page:")) {
      const rawSlug = localKey.startsWith("page_")
        ? localKey.slice("page_".length)
        : localKey.slice("page:".length);
      const slug = sanitizeSlug(rawSlug);
      if (!slug) continue;
      pages[slug] = stripHotMetadata(item.value);
    }
  }

  return siteConfig === undefined ? { pages } : { siteConfig, pages };
}

export function edgeItemsToTenantContent(items: EdgeItem[]): TenantContent {
  return edgeItemsToTenantContentForNamespace(items);
}

