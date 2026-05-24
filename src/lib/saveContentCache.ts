type ContentCacheValue = {
  siteConfig: unknown | null;
  pages: Record<string, unknown>;
  cachedAtMs: number;
};

const contentCache = new Map<string, ContentCacheValue>();

function buildCacheKey(input: { edgeConfigId: string; tenantId: string; namespace: string }): string {
  return `${input.edgeConfigId}::${input.tenantId}::${input.namespace}`;
}

export function getContentCache(input: {
  edgeConfigId: string;
  tenantId: string;
  namespace: string;
  nowMs: number;
  ttlMs: number;
  staleMs: number;
}): { fresh: ContentCacheValue | null; stale: ContentCacheValue | null } {
  const key = buildCacheKey(input);
  const entry = contentCache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const ageMs = input.nowMs - entry.cachedAtMs;
  if (ageMs <= input.ttlMs) return { fresh: entry, stale: entry };
  if (ageMs <= input.staleMs) return { fresh: null, stale: entry };
  contentCache.delete(key);
  return { fresh: null, stale: null };
}

export function setContentCache(input: {
  edgeConfigId: string;
  tenantId: string;
  namespace: string;
  siteConfig: unknown | null;
  pages: Record<string, unknown>;
  nowMs: number;
}) {
  const key = buildCacheKey(input);
  contentCache.set(key, {
    siteConfig: input.siteConfig,
    pages: input.pages,
    cachedAtMs: input.nowMs,
  });
}

export function invalidateContentCacheByTenant(tenantId: string) {
  const marker = `::${tenantId}::`;
  for (const key of contentCache.keys()) {
    if (key.includes(marker)) {
      contentCache.delete(key);
    }
  }
}
