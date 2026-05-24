import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";
import { isSave2RoutesBetaEnabled } from "@/lib/saveFeatureFlags";
import { readTenantContent, tenantNamespaceFromId } from "@/lib/tenantContentStore";
import { logSaveError, logSaveInfo, logSaveWarn, metricSave } from "@/lib/saveTelemetry";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

const responseHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

type TenantRecord = {
  id: string;
  slug: string;
  api_key: string;
};

function normalizeOutgoingPageKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const fromNamespaced = trimmed.match(/^t_[a-z0-9-]+_page_(.+)$/i)?.[1];
  const base = (fromNamespaced ?? trimmed)
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "-")
    .replace(/^\/+|\/+$/g, "");
  return base || "home";
}

function parseBearerApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

type ContentStatus = "ok" | "empty_namespace";

function hasTenantContent(content: { siteConfig?: unknown; pages: Record<string, unknown> }): boolean {
  return Boolean(content.siteConfig) || Object.keys(content.pages).length > 0;
}

function normalizePages(pages: Record<string, unknown>): Record<string, unknown> {
  const normalizedPages: Record<string, unknown> = {};
  for (const [rawKey, page] of Object.entries(pages)) {
    const normalizedKey = normalizeOutgoingPageKey(rawKey);
    normalizedPages[normalizedKey] = page;
  }
  return normalizedPages;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: responseHeaders });
}

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));

  if (!isSave2RoutesBetaEnabled()) {
    logSaveInfo("save.content.disabled", { correlationId });
    return NextResponse.json(
      {
        ok: false,
        error: "content endpoint is disabled by feature flags",
        code: "ERR_CONTENT_DISABLED",
        correlationId,
      },
      { status: 503, headers: responseHeaders }
    );
  }

  const apiKey = parseBearerApiKey(req);
  if (!apiKey) {
    logSaveWarn("save.content.unauthorized", { correlationId });
    return NextResponse.json(
      { ok: false, error: "Missing Bearer API key", code: "ERR_UNAUTHORIZED", correlationId },
      { status: 401, headers: responseHeaders }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id,slug,api_key")
    .eq("api_key", apiKey)
    .single<TenantRecord>();

  if (tenantError || !tenant?.id) {
    logSaveWarn("save.content.invalid_api_key", { correlationId });
    return NextResponse.json(
      { ok: false, error: "Invalid API key", code: "ERR_INVALID_API_KEY", correlationId },
      { status: 403, headers: responseHeaders }
    );
  }

  try {
    const namespace = tenantNamespaceFromId(tenant.id);
    const nowMs = Date.now();
    const content = (await readTenantContent(tenant.id)) ?? { siteConfig: null, pages: {} };
    const normalizedPages = normalizePages(content.pages);
    const namespaceMatchedKeys = Object.keys(normalizedPages).length;
    const contentStatus: ContentStatus = hasTenantContent({ siteConfig: content.siteConfig ?? null, pages: normalizedPages })
      ? "ok"
      : "empty_namespace";
    if (contentStatus === "empty_namespace") {
      metricSave("save.content.empty_namespace", 1, { tenantSlug: tenant.slug, namespaceMatchedKeys });
      logSaveWarn("save.content.empty_namespace", {
        correlationId,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        namespace,
        namespaceMatchedKeys,
      });
    } else {
      metricSave("save.content.read_success", 1, { tenantSlug: tenant.slug, namespaceMatchedKeys });
      logSaveInfo("save.content.read_success", { correlationId, tenantId: tenant.id, tenantSlug: tenant.slug, namespace, namespaceMatchedKeys });
    }

    return NextResponse.json(
      {
        ok: true,
        source: "supabase",
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        correlationId,
        updatedAt: nowMs,
        contentStatus,
        namespace,
        namespaceMatchedKeys,
        usedUnscopedFallback: false,
        legacyFallbackAvailable: false,
        servedFromCache: false,
        servedFromStaleCache: false,
        cacheAgeMs: 0,
        diagnostics: {
          sourceStore: "supabase",
          emptyNamespace: contentStatus === "empty_namespace",
        },
        siteConfig: content.siteConfig ?? null,
        pages: normalizedPages,
      },
      { status: 200, headers: responseHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content read failed";
    logSaveError("save.content.read_failed", {
      correlationId,
      tenantSlug: tenant.slug,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message, code: "ERR_CONTENT_READ_FAILED", correlationId },
      { status: 502, headers: responseHeaders }
    );
  }
}

