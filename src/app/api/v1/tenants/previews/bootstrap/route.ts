import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PreviewRefreshError, refreshTenantPreview } from "@/lib/tenantPreview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DEFAULT_PENDING_STALE_MS = 10 * 60 * 1000;
const DEFAULT_BOOTSTRAP_BATCH_SIZE = 4;
const MAX_BOOTSTRAP_BATCH_SIZE = 8;

type BootstrapBody = {
  tenantIds?: string[];
  priorityTenantIds?: string[];
};

function uniqueTenantIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const correlationId = req.headers.get("x-correlation-id");
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, code: "ERR_UNAUTHORIZED" }, { status: auth.data.status });
  }

  const body = (await req.json().catch(() => ({}))) as BootstrapBody;
  const tenantIds = uniqueTenantIds(body.tenantIds);
  const requestedPriorityIds = uniqueTenantIds(body.priorityTenantIds);
  const priorityTenantIdSet = new Set(requestedPriorityIds.filter((id) => tenantIds.includes(id)));
  if (tenantIds.length === 0) {
    return NextResponse.json({ ok: true, queued: 0 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenants, error } = await supabaseAdmin
    .from("tenants")
    .select("id, owner_id, vercel_public_url, preview_image_url, preview_status, preview_updated_at")
    .eq("owner_id", auth.data.user.id)
    .in("id", tenantIds);
  if (error) {
    return NextResponse.json({ error: "Failed to load tenant list", code: "ERR_TENANT_QUERY_FAILED" }, { status: 500 });
  }

  const staleMs = Number(process.env.TENANT_PREVIEW_PENDING_STALE_MS) || DEFAULT_PENDING_STALE_MS;
  const configuredBatchSize = Number(process.env.TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE);
  const batchSize = Number.isFinite(configuredBatchSize)
    ? Math.max(1, Math.min(MAX_BOOTSTRAP_BATCH_SIZE, Math.floor(configuredBatchSize)))
    : DEFAULT_BOOTSTRAP_BATCH_SIZE;
  const now = Date.now();
  const isPendingStale = (updatedAt?: string | null): boolean => {
    if (!updatedAt) return true;
    const ts = new Date(updatedAt).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts >= staleMs;
  };

  const tenantsWithUrl = (tenants ?? []).filter(
    (tenant) => typeof tenant.vercel_public_url === "string" && tenant.vercel_public_url.trim()
  );
  const priorityCandidates = tenantsWithUrl.filter((tenant) => priorityTenantIdSet.has(tenant.id));
  const regularCandidates = tenantsWithUrl
    .filter((tenant) => !priorityTenantIdSet.has(tenant.id))
    .filter((tenant) => !(tenant.preview_status === "ready" && typeof tenant.preview_image_url === "string"))
    .filter((tenant) => tenant.preview_status !== "pending" || isPendingStale(tenant.preview_updated_at));

  const candidates = [...priorityCandidates, ...regularCandidates].slice(0, batchSize);

  const results: Array<
    | { tenantId: string; ok: true }
    | { tenantId: string; ok: false; errorCode: string; error: string }
  > = [];
  for (const tenant of candidates) {
    try {
      await refreshTenantPreview({
        tenantId: tenant.id,
        reason: "dashboard_load",
        correlationId: req.headers.get("x-correlation-id"),
      });
      results.push({ tenantId: tenant.id, ok: true as const });
    } catch (error) {
      const normalized =
        error instanceof PreviewRefreshError
          ? error
          : new PreviewRefreshError("ERR_PREVIEW_CAPTURE_FAILED", error instanceof Error ? error.message : String(error));
      results.push({
        tenantId: tenant.id,
        ok: false as const,
        errorCode: normalized.code,
        error: normalized.message,
      });
    }
  }

  const completed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const queued = candidates.length;
  const priorityQueued = candidates.filter((tenant) => priorityTenantIdSet.has(tenant.id)).length;
  const priorityFailed = failed.filter((entry) => priorityTenantIdSet.has(entry.tenantId)).length;
  console.info("[tenant-preview.bootstrap.result]", {
    correlationId: correlationId ?? null,
    userId: auth.data.user.id,
    requestedTenantIds: tenantIds.length,
    queued,
    pendingStaleMs: staleMs,
    batchSize,
    priorityRequested: priorityTenantIdSet.size,
    priorityQueued,
    priorityFailed,
    completed,
    failedCount: failed.length,
    failedCodes: failed.map((entry) => entry.errorCode),
    bootstrap_latency_ms: Date.now() - startedAt,
  });
  console.info("[tenant-preview.speed.summary]", {
    scope: "bootstrap",
    correlationId: correlationId ?? null,
    userId: auth.data.user.id,
    batchSize,
    queued,
    completed,
    failedCount: failed.length,
    priorityRequested: priorityTenantIdSet.size,
    priorityQueued,
    priorityFailed,
    latency_ms: Date.now() - startedAt,
  });
  if (failed.length > 0) {
    console.error("[tenant-preview.bootstrap.failed]", {
      correlationId: correlationId ?? null,
      userId: auth.data.user.id,
      failed,
    });
  }
  return NextResponse.json({ ok: true, queued, completed, failed });
}
