import { NextRequest, NextResponse } from "next/server";
import { refreshTenantPreview } from "@/lib/tenantPreview";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RefreshRequestBody = {
  tenantId?: string;
  tenantUrl?: string;
  reason?: "provision" | "publish" | "dashboard_load" | "manual";
  correlationId?: string;
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

  const body = (await req.json().catch(() => ({}))) as RefreshRequestBody;
  const reason = body.reason ?? "manual";

  const tenantId = body.tenantId?.trim();
  const tenantUrl = body.tenantUrl?.trim();
  if (!tenantId && !tenantUrl) {
    return NextResponse.json(
      { error: "Missing tenantId or tenantUrl", code: "ERR_BAD_REQUEST" },
      { status: 400 }
    );
  }

  try {
    if (tenantId) {
      await refreshTenantPreview({
        tenantId,
        tenantUrl: tenantUrl ?? null,
        reason,
        correlationId: body.correlationId ?? req.headers.get("x-correlation-id"),
      });
      return NextResponse.json({ ok: true, tenantId });
    }

    // Manual refresh by URL only (best effort): try resolve by vercel_url.
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("vercel_url", tenantUrl!)
      .limit(1)
      .maybeSingle();

    if (!data?.id) {
      return NextResponse.json(
        { error: "Tenant not found for URL", code: "ERR_TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    await refreshTenantPreview({
      tenantId: data.id,
      tenantUrl: tenantUrl ?? null,
      reason,
      correlationId: body.correlationId ?? req.headers.get("x-correlation-id"),
    });

    return NextResponse.json({ ok: true, tenantId: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview refresh failed";
    return NextResponse.json(
      { error: message, code: "ERR_PREVIEW_REFRESH_FAILED" },
      { status: 500 }
    );
  }
}

