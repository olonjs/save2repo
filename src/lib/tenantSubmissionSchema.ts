/**
 * Fetch and cache `sectionSubmissionSchemas` from the tenant's public page
 * contract at `{tenantBaseUrl}/schemas/{slug}.schema.json`.
 *
 * Per ADR-0001 (MCP `submit-form` tool), the tenant site is the authoritative
 * source of the submission schema. The MCP gateway fetches it live on each
 * `submit-form` call, backed by a short-lived in-process cache.
 *
 * Tenant URL precedence (per ADR):
 *   1. active custom domain (`tenant_domains.status IN ('active','verified')`)
 *   2. `tenants.vercel_public_url`
 *   3. `tenants.vercel_url`
 */
import { getSupabaseAdmin } from "@/lib/supabase";

export type SubmitFormSchemaErrorCode =
  | "ERR_TENANT_BASE_URL_MISSING"
  | "ERR_SCHEMA_FETCH_FAILED"
  | "ERR_SCHEMA_INVALID"
  | "ERR_SECTION_SCHEMA_NOT_DECLARED";

export class SubmitFormSchemaError extends Error {
  readonly code: SubmitFormSchemaErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SubmitFormSchemaErrorCode,
    message: string,
    httpStatus = 502,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SubmitFormSchemaError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

type TenantBaseUrlRow = {
  vercel_public_url: string | null;
  vercel_url: string | null;
};

type TenantDomainRow = {
  domain: string;
  created_at: string;
};

export type TenantBaseUrl = {
  tenantBaseUrl: string;
  source: "custom_domain" | "vercel_public_url" | "vercel_url";
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    // Strip trailing slash and any path/query so callers can safely append `/schemas/...`.
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Resolve a tenant's authoritative base URL for public contract fetches.
 * Returns null if none of the known URL sources yields a usable value.
 *
 * Internal helper; exported for test visibility.
 */
export async function resolveTenantBaseUrl(tenantId: string): Promise<TenantBaseUrl | null> {
  const supabaseAdmin = getSupabaseAdmin();

  const domainProbe = await supabaseAdmin
    .from("tenant_domains")
    .select("domain,created_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .in("status", ["active", "verified"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<TenantDomainRow>();

  if (!domainProbe.error && domainProbe.data?.domain) {
    const normalized = normalizeBaseUrl(domainProbe.data.domain);
    if (normalized) {
      return { tenantBaseUrl: normalized, source: "custom_domain" };
    }
  }

  const tenantProbe = await supabaseAdmin
    .from("tenants")
    .select("vercel_public_url,vercel_url")
    .eq("id", tenantId)
    .maybeSingle<TenantBaseUrlRow>();

  if (tenantProbe.error || !tenantProbe.data) return null;

  const publicNormalized = normalizeBaseUrl(tenantProbe.data.vercel_public_url);
  if (publicNormalized) {
    return { tenantBaseUrl: publicNormalized, source: "vercel_public_url" };
  }

  const fallbackNormalized = normalizeBaseUrl(tenantProbe.data.vercel_url);
  if (fallbackNormalized) {
    return { tenantBaseUrl: fallbackNormalized, source: "vercel_url" };
  }

  return null;
}

const CACHE_TTL_MS = Number(process.env.MCP_SUBMIT_FORM_SCHEMA_TTL_MS ?? 60_000);
const FETCH_TIMEOUT_MS = Number(process.env.MCP_SUBMIT_FORM_SCHEMA_FETCH_TIMEOUT_MS ?? 5_000);

export type PageContractSnapshot = {
  baseUrl: string;
  sectionSchemas: Record<string, Record<string, unknown>>;
  sectionSubmissionSchemas: Record<string, Record<string, unknown>>;
};

type CacheValue = PageContractSnapshot & {
  expiresAt: number;
};

const schemaCache = new Map<string, CacheValue>();

function cacheKey(tenantId: string, slug: string): string {
  return `${tenantId}::${slug}`;
}

/**
 * Test-only: clear the in-process schema cache. No-op outside NODE_ENV=test.
 * Not exported through the gateway; invoked directly by unit tests.
 */
export function __clearSubmitFormSchemaCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  schemaCache.clear();
}

async function fetchContract(url: string, correlationId: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Correlation-Id": correlationId,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SubmitFormSchemaError(
        "ERR_SCHEMA_FETCH_FAILED",
        `Schema contract fetch failed with status ${response.status}`,
        502,
        { url, status: response.status }
      );
    }
    const json = (await response.json()) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new SubmitFormSchemaError(
        "ERR_SCHEMA_INVALID",
        "Schema contract is not a JSON object",
        502,
        { url }
      );
    }
    return json as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SubmitFormSchemaError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new SubmitFormSchemaError(
      "ERR_SCHEMA_FETCH_FAILED",
      aborted ? `Schema contract fetch timed out after ${FETCH_TIMEOUT_MS}ms` : message,
      502,
      { url, aborted }
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractSchemaMap(
  contract: Record<string, unknown>,
  key: "sectionSchemas" | "sectionSubmissionSchemas"
): Record<string, Record<string, unknown>> {
  const raw = contract[key];
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SubmitFormSchemaError(
      "ERR_SCHEMA_INVALID",
      `${key} must be an object keyed by section type`,
      502
    );
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [sectionType, schema] of Object.entries(raw as Record<string, unknown>)) {
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      out[sectionType] = schema as Record<string, unknown>;
    }
  }
  return out;
}

/**
 * Fetch the full page contract snapshot (section schemas + submission schemas)
 * for a given page on a given tenant, using a short-lived in-process cache.
 *
 * This is the canonical source of live discovery data for the MCP gateway:
 * `read-content` uses it to enrich responses with form shape; `submit-form`
 * uses it (via `requireSubmissionSchema`) to validate payloads.
 *
 * Throws `SubmitFormSchemaError` if the tenant has no public base URL, the
 * contract endpoint is unreachable, or the contract is malformed. Callers
 * that want soft-fail semantics (e.g. `read-content`) must catch and degrade.
 */
export async function fetchPageContractSnapshot(params: {
  tenantId: string;
  slug: string;
  correlationId: string;
}): Promise<PageContractSnapshot> {
  const now = Date.now();
  const key = cacheKey(params.tenantId, params.slug);
  const cached = schemaCache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      baseUrl: cached.baseUrl,
      sectionSchemas: cached.sectionSchemas,
      sectionSubmissionSchemas: cached.sectionSubmissionSchemas,
    };
  }

  const resolved = await resolveTenantBaseUrl(params.tenantId);
  if (!resolved) {
    throw new SubmitFormSchemaError(
      "ERR_TENANT_BASE_URL_MISSING",
      "Tenant has no resolvable public base URL (custom domain, vercel_public_url, vercel_url)",
      409,
      { tenantId: params.tenantId }
    );
  }

  const contractUrl = `${resolved.tenantBaseUrl}/schemas/${encodeURIComponent(params.slug)}.schema.json`;
  const contract = await fetchContract(contractUrl, params.correlationId);
  const sectionSchemas = extractSchemaMap(contract, "sectionSchemas");
  const sectionSubmissionSchemas = extractSchemaMap(contract, "sectionSubmissionSchemas");

  schemaCache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    baseUrl: resolved.tenantBaseUrl,
    sectionSchemas,
    sectionSubmissionSchemas,
  });

  return {
    baseUrl: resolved.tenantBaseUrl,
    sectionSchemas,
    sectionSubmissionSchemas,
  };
}

/**
 * Back-compat convenience for callers that only need submission schemas.
 * Delegates to `fetchPageContractSnapshot` and returns the submission slice.
 */
export async function fetchSubmissionSchemasForPage(params: {
  tenantId: string;
  slug: string;
  correlationId: string;
}): Promise<{ baseUrl: string; sectionSubmissionSchemas: Record<string, Record<string, unknown>> }> {
  const snap = await fetchPageContractSnapshot(params);
  return {
    baseUrl: snap.baseUrl,
    sectionSubmissionSchemas: snap.sectionSubmissionSchemas,
  };
}

/**
 * Convenience wrapper: resolve the submission schema for a specific
 * `(slug, sectionType)` pair or throw `ERR_SECTION_SCHEMA_NOT_DECLARED` if
 * the tenant has not declared one.
 */
export async function requireSubmissionSchema(params: {
  tenantId: string;
  slug: string;
  sectionType: string;
  correlationId: string;
}): Promise<{ baseUrl: string; schema: Record<string, unknown> }> {
  const { baseUrl, sectionSubmissionSchemas } = await fetchSubmissionSchemasForPage({
    tenantId: params.tenantId,
    slug: params.slug,
    correlationId: params.correlationId,
  });
  const schema = sectionSubmissionSchemas[params.sectionType];
  if (!schema) {
    throw new SubmitFormSchemaError(
      "ERR_SECTION_SCHEMA_NOT_DECLARED",
      `Section type '${params.sectionType}' has no declared submission schema on this tenant`,
      409,
      { tenantId: params.tenantId, slug: params.slug, sectionType: params.sectionType }
    );
  }
  return { baseUrl, schema };
}
