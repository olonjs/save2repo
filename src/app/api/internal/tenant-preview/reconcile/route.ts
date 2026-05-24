import { NextRequest, NextResponse } from "next/server";
import { reconcileTenantPreviews } from "@/lib/tenantPreview";

export const dynamic = "force-dynamic";

type ReconcileRequestBody = {
  tenantIds?: string[];
  reason?: "provision" | "publish" | "dashboard_load" | "manual";
  correlationId?: string;
  pendingGraceMs?: number;
  limit?: number;
};

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.TENANT_PREVIEW_INTERNAL_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV === "development";
  const provided = req.headers.get("x-preview-refresh-token")?.trim();
  return Boolean(provided && provided === expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized", code: "ERR_UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ReconcileRequestBody;
  try {
    const result = await reconcileTenantPreviews({
      tenantIds: Array.isArray(body.tenantIds) ? body.tenantIds : [],
      reason: body.reason ?? "manual",
      correlationId: body.correlationId ?? req.headers.get("x-correlation-id"),
      pendingGraceMs: typeof body.pendingGraceMs === "number" ? body.pendingGraceMs : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview reconcile failed";
    return NextResponse.json({ error: message, code: "ERR_PREVIEW_RECONCILE_FAILED" }, { status: 500 });
  }
}
