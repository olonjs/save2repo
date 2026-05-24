import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCorrelationId } from "@/lib/licensing";
import { isSave2RoutesBetaEnabled, isSaveHotEnabled } from "@/lib/saveFeatureFlags";
import {
  readTenantContent,
  replaceTenantContent,
  tenantNamespaceFromId,
  upsertTenantPage,
  upsertTenantSiteConfig,
} from "@/lib/tenantContentStore";
import { logSaveError, logSaveInfo, metricSave } from "@/lib/saveTelemetry";
import { resolveTenantBaseUrl, generateTenantStaticFiles, uploadTenantStaticFiles } from "@/lib/tenantStaticFiles";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Correlation-Id",
};

type HotEntityType = "page" | "config";

type TenantRecord = {
  id: string;
  slug: string;
  api_key: string;
  unsynced_changes_count: number | null;
};

type HotSaveBody = {
  slug: string;
  data: unknown;
  type: HotEntityType;
};

type HotSaveCombinedBody = {
  slug: string;
  page: unknown;
  siteConfig: unknown;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge incoming site payload over current store payload.
 * - Preserves existing object branches when incoming payload is partial.
 * - Uses incoming arrays/scalars as-is when provided.
 * - Treats null/undefined incoming as "no update" to avoid accidental wipe.
 */
function mergeSiteConfig(currentSite: unknown, incomingSite: unknown): unknown {
  if (incomingSite == null) return currentSite ?? null;
  if (!isObjectRecord(currentSite) || !isObjectRecord(incomingSite)) return incomingSite;

  const output: Record<string, unknown> = { ...currentSite };
  for (const [key, incomingValue] of Object.entries(incomingSite)) {
    const currentValue = output[key];
    if (incomingValue == null) {
      output[key] = currentValue;
      continue;
    }
    if (isObjectRecord(currentValue) && isObjectRecord(incomingValue)) {
      output[key] = mergeSiteConfig(currentValue, incomingValue);
      continue;
    }
    output[key] = incomingValue;
  }
  return output;
}

function parseBearerApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;

  if (!isSave2RoutesBetaEnabled() || !isSaveHotEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "hotSave is disabled by feature flags",
        code: "ERR_HOTSAVE_DISABLED",
        correlationId,
      },
      { status: 503, headers: corsHeaders }
    );
  }

  const apiKey = parseBearerApiKey(req);
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Bearer API key", code: "ERR_UNAUTHORIZED", correlationId },
      { status: 401, headers: corsHeaders }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Partial<HotSaveBody & HotSaveCombinedBody>;
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const normalizedSlug = slug.replace(/[^a-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "") || "home";
  const isCombinedPayload = body.page != null && body.siteConfig != null;
  const type = body.type === "config" ? "config" : body.type === "page" ? "page" : null;
  const data = body.data;
  if (!slug || (!isCombinedPayload && (!type || data == null))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing slug and either (type/data) or (page/siteConfig)",
        code: "ERR_BAD_REQUEST",
        correlationId,
      },
      { status: 400, headers: corsHeaders }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id,slug,api_key,unsynced_changes_count")
    .eq("api_key", apiKey)
    .single<TenantRecord>();

  if (tenantError || !tenant?.id) {
    return NextResponse.json(
      { ok: false, error: "Invalid API key", code: "ERR_INVALID_API_KEY", correlationId },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
    const startedAt = Date.now();
    if (isCombinedPayload) {
      const current = (await readTenantContent(tenant.id)) ?? { siteConfig: null, pages: {} };
      const mergedSiteConfig = mergeSiteConfig(current.siteConfig ?? null, body.siteConfig);
      await replaceTenantContent(
        tenant.id,
        {
          siteConfig: mergedSiteConfig,
          pages: {
            ...current.pages,
            [normalizedSlug]: body.page,
          },
        },
        { updatedBy: `api_key:${tenant.api_key.slice(0, 8)}` }
      );
    } else if (type === "page") {
      await upsertTenantPage(tenant.id, normalizedSlug, data, {
        updatedBy: `api_key:${tenant.api_key.slice(0, 8)}`,
      });
    } else {
      const current = (await readTenantContent(tenant.id)) ?? { siteConfig: null, pages: {} };
      const mergedSiteConfig = mergeSiteConfig(current.siteConfig ?? null, data);
      await upsertTenantSiteConfig(tenant.id, mergedSiteConfig, { updatedBy: `api_key:${tenant.api_key.slice(0, 8)}` });
    }

    const nextCount = (tenant.unsynced_changes_count ?? 0) + 1;
    const nowIso = new Date().toISOString();
    const { error: stateError } = await supabaseAdmin
      .from("tenants")
      .update({
        unsynced_changes_count: nextCount,
        sync_status: "dirty",
        last_hot_save_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", tenant.id);

    if (stateError) {
      logSaveError("hotsave.state_update_failed", {
        tenantId: tenant.id,
        correlationId,
        message: stateError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Store write completed but state update failed",
          code: "ERR_HOTSAVE_STATE_UPDATE_FAILED",
          correlationId,
        },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      const content = await readTenantContent(tenant.id);
      if (content) {
        const baseUrl = await resolveTenantBaseUrl(tenant.id);
        const files = generateTenantStaticFiles({ tenantSlug: tenant.slug, pages: content.pages, siteConfig: content.siteConfig, baseUrl });
        await uploadTenantStaticFiles(files);
      }
    } catch (blobErr) {
      logSaveError("hotsave.blob_static_files_failed", { tenantId: tenant.id, correlationId, message: blobErr instanceof Error ? blobErr.message : "unknown" });
    }

    const elapsedMs = Date.now() - startedAt;
    const namespace = tenantNamespaceFromId(tenant.id);
    const savedMode: "bundle" | HotEntityType = isCombinedPayload ? "bundle" : (type ?? "page");
    metricSave("hotsave_success", 1, { tenantId: tenant.id, type: savedMode, elapsedMs });
    logSaveInfo("hotsave.completed", {
      tenantId: tenant.id,
      correlationId,
      elapsedMs,
      idempotencyKey,
      unsyncedChangesCount: nextCount,
      namespace,
      slug: normalizedSlug,
      type: savedMode,
    });

    return NextResponse.json(
      {
        ok: true,
        correlationId,
        idempotencyKey,
        key: isCombinedPayload
          ? `${namespace}_bundle_${normalizedSlug}`
          : `${namespace}_${type === "config" ? "config_site" : `page_${normalizedSlug}`}`,
        savedEntities: isCombinedPayload ? ["page", "config"] : [savedMode],
        unsyncedChangesCount: nextCount,
        savedAt: nowIso,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hot save failed";
    logSaveError("hotsave.failed", {
      tenantId: tenant.id,
      correlationId,
      message,
      type: isCombinedPayload ? "bundle" : type,
      slug: normalizedSlug,
    });
    metricSave("hotsave_error", 1, { tenantId: tenant.id, type: isCombinedPayload ? "bundle" : type ?? "unknown" });
    return NextResponse.json(
      { ok: false, error: message, code: "ERR_HOTSAVE_WRITE_FAILED", correlationId },
      { status: 502, headers: corsHeaders }
    );
  }
}
