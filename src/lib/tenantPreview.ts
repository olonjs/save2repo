import { lookup } from "dns/promises";
import { isIP } from "net";
import { put } from "@vercel/blob";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import { getSupabaseAdmin } from "@/lib/supabase";

type PreviewStatus = "pending" | "ready" | "failed";
type PreviewReason = "provision" | "publish" | "dashboard_load" | "manual";

type RefreshPreviewInput = {
  tenantId: string;
  tenantUrl?: string | null;
  reason: PreviewReason;
  correlationId?: string | null;
};

type ReconcilePreviewInput = {
  tenantIds?: string[];
  reason?: PreviewReason;
  correlationId?: string | null;
  pendingGraceMs?: number;
  limit?: number;
};

export type PreviewRefreshErrorCode =
  | "ERR_PREVIEW_URL_MISSING"
  | "ERR_PREVIEW_URL_INVALID"
  | "ERR_PREVIEW_URL_NOT_HTTPS"
  | "ERR_PREVIEW_URL_HOST_NOT_ALLOWED"
  | "ERR_PREVIEW_URL_DNS_RESOLVE_FAILED"
  | "ERR_PREVIEW_URL_PRIVATE_IP"
  | "ERR_PREVIEW_BLOB_TOKEN_MISSING"
  | "ERR_PREVIEW_READY_SIGNAL_TIMEOUT"
  | "ERR_PREVIEW_CAPTURE_TIMEOUT"
  | "ERR_PREVIEW_CAPTURE_FAILED";

export class PreviewRefreshError extends Error {
  code: PreviewRefreshErrorCode;
  constructor(code: PreviewRefreshErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PreviewRefreshError";
  }
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 14000;
const DEFAULT_CAPTURE_RETRIES = 1;
const DEFAULT_CAPTURE_WAIT_UNTIL: "domcontentloaded" | "networkidle" = "domcontentloaded";
const DEFAULT_CAPTURE_SETTLE_MS = 400;
const DEFAULT_READY_SIGNAL_TIMEOUT_MS = 6000;
const DEFAULT_READY_SIGNAL_FALLBACK_WAIT_MS = 3000;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const DEFAULT_JPEG_QUALITY = 65;
const DEFAULT_RECONCILE_PENDING_GRACE_MS = 30 * 1000;
const DEFAULT_RECONCILE_LIMIT = 4;
const MAX_RECONCILE_LIMIT = 12;

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCaptureWaitUntil():
  | "load"
  | "domcontentloaded"
  | "networkidle"
  | "commit" {
  const raw = (process.env.TENANT_PREVIEW_WAIT_UNTIL ?? "").trim().toLowerCase();
  if (raw === "load" || raw === "networkidle" || raw === "commit" || raw === "domcontentloaded") {
    return raw;
  }
  return DEFAULT_CAPTURE_WAIT_UNTIL;
}

function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) return true;
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map((n) => Number(n));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isAllowedHost(hostname: string, tenantAllowedHosts: string[] = []): boolean {
  const lower = hostname.toLowerCase();
  const fromEnv = parseCsv(process.env.TENANT_PREVIEW_ALLOWED_HOSTS);
  // Always allow Vercel deployment hostnames; merge env extras + tenant domains (for manual refresh URLs).
  const allowed = Array.from(new Set(["vercel.app", ...fromEnv, ...tenantAllowedHosts]));
  return allowed.some((entry) => lower === entry || lower.endsWith(`.${entry}`));
}

async function resolveTenantAllowedHosts(tenantId: string): Promise<string[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenant_domains")
    .select("domain, status, deleted_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return [];
  return (data ?? [])
    .filter((entry) => typeof entry.domain === "string" && entry.domain.trim())
    .filter((entry) => entry.status === "active" || entry.status === "verified")
    .map((entry) => entry.domain.trim().toLowerCase());
}

async function assertPreviewUrlIsSafe(rawUrl: string, tenantId: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PreviewRefreshError("ERR_PREVIEW_URL_INVALID", "Invalid tenant URL");
  }
  if (parsed.protocol !== "https:") {
    throw new PreviewRefreshError("ERR_PREVIEW_URL_NOT_HTTPS", "Only HTTPS preview URLs are allowed");
  }
  const tenantAllowedHosts = await resolveTenantAllowedHosts(tenantId);
  if (!isAllowedHost(parsed.hostname, tenantAllowedHosts)) {
    throw new PreviewRefreshError("ERR_PREVIEW_URL_HOST_NOT_ALLOWED", "Preview host is not in allowlist");
  }

  const resolved = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!resolved.length) {
    throw new PreviewRefreshError("ERR_PREVIEW_URL_DNS_RESOLVE_FAILED", "Preview host did not resolve");
  }
  for (const addr of resolved) {
    if (isPrivateIp(addr.address)) {
      throw new PreviewRefreshError("ERR_PREVIEW_URL_PRIVATE_IP", "Preview host resolves to private/internal IP");
    }
  }
  return parsed;
}

async function capturePreviewImageBytes(targetUrl: string, correlationId?: string | null): Promise<Uint8Array> {
  const timeoutMs = parsePositiveInt(process.env.TENANT_PREVIEW_TIMEOUT_MS, DEFAULT_CAPTURE_TIMEOUT_MS);
  const retries = parsePositiveInt(process.env.TENANT_PREVIEW_RETRIES, DEFAULT_CAPTURE_RETRIES);
  const waitUntil = resolveCaptureWaitUntil();
  const settleMs = parsePositiveInt(process.env.TENANT_PREVIEW_SETTLE_MS, DEFAULT_CAPTURE_SETTLE_MS);
  const readySignalTimeoutMs = parseNonNegativeInt(
    process.env.TENANT_PREVIEW_READY_SIGNAL_TIMEOUT_MS,
    DEFAULT_READY_SIGNAL_TIMEOUT_MS
  );
  const readySignalFallbackWaitMs = parseNonNegativeInt(
    process.env.TENANT_PREVIEW_READY_SIGNAL_FALLBACK_WAIT_MS,
    DEFAULT_READY_SIGNAL_FALLBACK_WAIT_MS
  );
  const requireReadySignal = parseBoolean(process.env.TENANT_PREVIEW_REQUIRE_READY_SIGNAL, false);
  const viewportWidth = parsePositiveInt(process.env.TENANT_PREVIEW_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_WIDTH);
  const viewportHeight = parsePositiveInt(process.env.TENANT_PREVIEW_VIEWPORT_HEIGHT, DEFAULT_VIEWPORT_HEIGHT);
  const jpegQuality = Math.max(
    1,
    Math.min(100, parsePositiveInt(process.env.TENANT_PREVIEW_JPEG_QUALITY, DEFAULT_JPEG_QUALITY))
  );
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const startedAt = Date.now();
    let browser: Awaited<ReturnType<typeof playwrightChromium.launch>> | null = null;
    try {
      const executablePath = await chromium.executablePath();
      browser = await playwrightChromium.launch({
        args: chromium.args,
        executablePath,
        headless: true,
      });
      const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
      // Vercel Deployment Protection returns 401 for unauthenticated requests to *.vercel.app.
      // Set "Protection Bypass for Automation" on the tenant project, then set this secret on the platform.
      const vercelBypass = (process.env.TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS ?? "").trim();
      if (vercelBypass) {
        await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": vercelBypass });
      }
      await page.goto(targetUrl, { waitUntil, timeout: timeoutMs });
      let readySignalObserved = false;
      if (readySignalTimeoutMs > 0) {
        try {
          await page.waitForFunction(
            () =>
              (globalThis as { __TENANT_PREVIEW_READY__?: boolean }).__TENANT_PREVIEW_READY__ === true ||
              document.body?.dataset?.previewReady === "1",
            { timeout: readySignalTimeoutMs }
          );
          readySignalObserved = true;
        } catch (error) {
          if (requireReadySignal) {
            throw new PreviewRefreshError(
              "ERR_PREVIEW_READY_SIGNAL_TIMEOUT",
              `Preview ready signal timeout after ${readySignalTimeoutMs}ms`
            );
          }
          const fallbackWaitMs = Math.min(readySignalFallbackWaitMs, timeoutMs);
          console.warn("[tenant-preview.capture.ready_signal_timeout]", {
            correlationId: correlationId ?? null,
            attempt,
            ready_signal_timeout_ms: readySignalTimeoutMs,
            fallback_wait_ms: fallbackWaitMs,
            error: error instanceof Error ? error.message : "unknown",
          });
          if (fallbackWaitMs > 0) {
            await page.waitForLoadState("networkidle", { timeout: fallbackWaitMs }).catch(() => undefined);
          }
        }
      }
      if (settleMs > 0) await delay(settleMs);
      const screenshot = await page.screenshot({ type: "jpeg", quality: jpegQuality, fullPage: false });
      const bytes = new Uint8Array(screenshot);
      console.info("[tenant-preview.capture.success]", {
        correlationId: correlationId ?? null,
        attempt,
        capture_latency_ms: Date.now() - startedAt,
        image_bytes: bytes.byteLength,
        wait_until: waitUntil,
        ready_signal_observed: readySignalObserved,
        ready_signal_timeout_ms: readySignalTimeoutMs,
        require_ready_signal: requireReadySignal,
        settle_ms: settleMs,
        viewport: `${viewportWidth}x${viewportHeight}`,
        jpeg_quality: jpegQuality,
      });
      return bytes;
    } catch (error) {
      lastError = error;
      console.warn("[tenant-preview.capture.retry]", {
        correlationId: correlationId ?? null,
        attempt,
        capture_latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (attempt <= retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Capture failed after retries");
}

async function setPreviewStatus(tenantId: string, status: PreviewStatus, patch?: Record<string, unknown>): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("tenants")
    .update({
      preview_status: status,
      ...(patch ?? {}),
    })
    .eq("id", tenantId);
  if (error) throw error;
}

async function resolveTenantUrl(tenantId: string): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("vercel_public_url")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.vercel_public_url === "string" ? data.vercel_public_url : null;
}

function resolveBlobToken(): string {
  const primary = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (primary) return primary;
  const legacyAlias = process.env.JSONPAGES_READ_WRITE_TOKEN?.trim();
  if (legacyAlias) return legacyAlias;
  throw new PreviewRefreshError(
    "ERR_PREVIEW_BLOB_TOKEN_MISSING",
    "Missing blob token: set BLOB_READ_WRITE_TOKEN or JSONPAGES_READ_WRITE_TOKEN"
  );
}

function toPreviewRefreshError(error: unknown): PreviewRefreshError {
  if (error instanceof PreviewRefreshError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|navigation/i.test(message)) {
    return new PreviewRefreshError("ERR_PREVIEW_CAPTURE_TIMEOUT", `Preview capture timeout: ${message}`);
  }
  return new PreviewRefreshError("ERR_PREVIEW_CAPTURE_FAILED", message || "Preview capture failed");
}

export async function refreshTenantPreview(input: RefreshPreviewInput): Promise<void> {
  const { tenantId, reason, correlationId } = input;
  const startedAt = Date.now();
  let stage: "preflight" | "capture" = "preflight";
  try {
    const tenantUrl = input.tenantUrl ?? (await resolveTenantUrl(tenantId));
    if (!tenantUrl) {
      throw new PreviewRefreshError("ERR_PREVIEW_URL_MISSING", "Tenant URL missing for preview refresh");
    }

    const safeUrl = await assertPreviewUrlIsSafe(tenantUrl, tenantId);
    await setPreviewStatus(tenantId, "pending", { preview_updated_at: new Date().toISOString() });
    stage = "capture";

    const bytes = await capturePreviewImageBytes(safeUrl.toString(), correlationId);
    const objectPath = `tenant-previews/${tenantId}/${Date.now()}.jpg`;
    const blobToken = resolveBlobToken();
    const blob = await put(objectPath, Buffer.from(bytes), {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/jpeg",
      token: blobToken,
    });

    await setPreviewStatus(tenantId, "ready", {
      preview_image_url: `${blob.url}?v=${Date.now()}`,
      preview_updated_at: new Date().toISOString(),
    });

    console.info("[tenant-preview.refresh.completed]", {
      tenantId,
      reason,
      correlationId: correlationId ?? null,
      previewImageUrl: blob.url,
      refresh_latency_ms: Date.now() - startedAt,
    });
    console.info("[tenant-preview.speed.summary]", {
      scope: "refresh",
      status: "completed",
      tenantId,
      reason,
      correlationId: correlationId ?? null,
      latency_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const normalized = toPreviewRefreshError(error);
    await setPreviewStatus(tenantId, "failed", { preview_updated_at: new Date().toISOString() }).catch((statusError) => {
      console.error("[tenant-preview.refresh.failed_status_update]", {
        tenantId,
        reason,
        correlationId: correlationId ?? null,
        statusUpdateError: statusError instanceof Error ? statusError.message : String(statusError),
      });
    });
    console.error("[tenant-preview.refresh.failed]", {
      tenantId,
      reason,
      stage,
      code: normalized.code,
      message: normalized.message,
      correlationId: correlationId ?? null,
      refresh_latency_ms: Date.now() - startedAt,
    });
    console.info("[tenant-preview.speed.summary]", {
      scope: "refresh",
      status: "failed",
      tenantId,
      reason,
      correlationId: correlationId ?? null,
      code: normalized.code,
      latency_ms: Date.now() - startedAt,
    });
    throw normalized;
  }
}

export async function reconcileTenantPreviews(input: ReconcilePreviewInput = {}): Promise<{
  queued: number;
  completed: number;
  failed: Array<{ tenantId: string; errorCode: string; error: string }>;
}> {
  const startedAt = Date.now();
  const reason = input.reason ?? "manual";
  const correlationId = input.correlationId ?? null;
  const pendingGraceMs = parseNonNegativeInt(
    input.pendingGraceMs?.toString() ?? process.env.TENANT_PREVIEW_RECONCILE_PENDING_GRACE_MS,
    DEFAULT_RECONCILE_PENDING_GRACE_MS
  );
  const requestedLimit = parsePositiveInt(
    input.limit?.toString() ?? process.env.TENANT_PREVIEW_RECONCILE_LIMIT,
    DEFAULT_RECONCILE_LIMIT
  );
  const limit = Math.max(1, Math.min(MAX_RECONCILE_LIMIT, requestedLimit));
  const tenantIds = Array.from(new Set((input.tenantIds ?? []).map((id) => id.trim()).filter(Boolean)));

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from("tenants")
    .select("id, vercel_public_url, preview_image_url, preview_status, preview_updated_at")
    .limit(Math.max(limit, tenantIds.length || 1));
  if (tenantIds.length > 0) {
    query = query.in("id", tenantIds);
  }

  const { data: tenants, error } = await query;
  if (error) {
    throw new PreviewRefreshError("ERR_PREVIEW_CAPTURE_FAILED", `Preview reconcile query failed: ${error.message}`);
  }

  const now = Date.now();
  const isPendingEligible = (updatedAt?: string | null) => {
    if (!updatedAt) return true;
    const ts = new Date(updatedAt).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts >= pendingGraceMs;
  };

  const candidates = (tenants ?? [])
    .filter((tenant) => typeof tenant.vercel_public_url === "string" && tenant.vercel_public_url.trim())
    .filter((tenant) => !(tenant.preview_status === "ready" && typeof tenant.preview_image_url === "string"))
    .filter((tenant) => tenant.preview_status !== "pending" || isPendingEligible(tenant.preview_updated_at))
    .slice(0, limit);

  const results = await Promise.all(
    candidates.map(async (tenant) => {
      try {
        await refreshTenantPreview({
          tenantId: tenant.id,
          reason,
          correlationId,
        });
        return { tenantId: tenant.id, ok: true as const };
      } catch (err) {
        const normalized = toPreviewRefreshError(err);
        return {
          tenantId: tenant.id,
          ok: false as const,
          errorCode: normalized.code,
          error: normalized.message,
        };
      }
    })
  );

  const completed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  console.info("[tenant-preview.reconcile.summary]", {
    correlationId,
    reason,
    tenantIdsRequested: tenantIds.length,
    pendingGraceMs,
    limit,
    queued: candidates.length,
    completed,
    failedCount: failed.length,
    failedCodes: failed.map((entry) => entry.errorCode),
    latency_ms: Date.now() - startedAt,
  });

  return { queued: candidates.length, completed, failed };
}

