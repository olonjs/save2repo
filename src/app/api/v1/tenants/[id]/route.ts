import { NextRequest, NextResponse } from "next/server";
import { resolveCorrelationId } from "@/lib/licensing";
import { assertTenantAccess, requireRequestUser } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { deleteTenantBlobFolders, deleteTenantCloudflareZones } from "@/lib/tenantDeletion";

export const dynamic = "force-dynamic";

type DeleteTenantRpcRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  deployments_deleted: number | null;
  entitlements_released: number | null;
};

type TenantDeleteEventRow = {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  idempotency_key: string;
  status: "pending" | "success" | "error";
  response_payload: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
};

type TenantDeleteRecord = {
  id: string;
  name: string;
  slug: string;
  vercel_project_id: string | null;
};

type VercelDeleteResult = {
  identifier: string;
  status: number;
  alreadyMissing: boolean;
};

async function deleteVercelProjectForTenantStrict(tenant: TenantDeleteRecord): Promise<VercelDeleteResult> {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const token = process.env.VERCEL_AUTH_TOKEN?.trim();
  if (!teamId || !token) {
    throw new Error("Vercel delete not configured: missing VERCEL_TEAM_ID or VERCEL_AUTH_TOKEN");
  }

  const identifier = (tenant.vercel_project_id || tenant.slug).trim();
  if (!identifier) {
    throw new Error("Missing Vercel project identifier for tenant delete");
  }

  const response = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(identifier)}?teamId=${encodeURIComponent(teamId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.ok || response.status === 404) {
    return { identifier, status: response.status, alreadyMissing: response.status === 404 };
  }

  const payload = await response.json().catch(() => ({}));
  const providerMessage =
    (payload as { error?: { message?: string } })?.error?.message || `HTTP ${response.status}`;
  throw new Error(`Vercel project delete failed (${identifier}): ${providerMessage}`);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? null;

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: "Missing Idempotency-Key header",
        code: "ERR_TENANT_DELETE_IDEMPOTENCY_REQUIRED",
        correlationId,
      },
      { status: 400 }
    );
  }

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: previousEvent, error: previousEventError } = await supabaseAdmin
    .from("tenant_delete_events")
    .select("id,tenant_id,actor_user_id,idempotency_key,status,response_payload,error_code,error_message,http_status")
    .eq("tenant_id", params.id)
    .eq("actor_user_id", auth.data.user.id)
    .eq("idempotency_key", idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<TenantDeleteEventRow>();

  if (previousEventError) {
    return NextResponse.json(
      {
        error: "Failed to resolve delete idempotency state",
        code: "ERR_TENANT_DELETE_IDEMPOTENCY_LOOKUP_FAILED",
        correlationId,
      },
      { status: 500 }
    );
  }

  if (previousEvent?.status === "success" && previousEvent.response_payload) {
    return NextResponse.json({
      correlationId,
      idempotentReplay: true,
      ...previousEvent.response_payload,
    });
  }

  if (previousEvent?.status === "pending") {
    return NextResponse.json(
      {
        error: "Delete already in progress for this idempotency key",
        code: "ERR_TENANT_DELETE_IN_PROGRESS",
        correlationId,
      },
      { status: 409 }
    );
  }

  if (previousEvent?.status === "error") {
    return NextResponse.json(
      {
        error: previousEvent.error_message || "Previous delete attempt failed",
        code: previousEvent.error_code || "ERR_TENANT_DELETE_PREVIOUS_ATTEMPT_FAILED",
        correlationId,
        idempotentReplay: true,
      },
      { status: previousEvent.http_status || 500 }
    );
  }

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: "admin",
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.data.error, code: access.data.code, correlationId },
      { status: access.data.status }
    );
  }

  const { data: tenantRecord, error: tenantLookupError } = await supabaseAdmin
    .from("tenants")
    .select("id,name,slug,vercel_project_id")
    .eq("id", params.id)
    .maybeSingle<TenantDeleteRecord>();
  if (tenantLookupError) {
    return NextResponse.json(
      {
        error: "Failed to resolve tenant before delete",
        code: "ERR_TENANT_DELETE_LOOKUP_FAILED",
        correlationId,
      },
      { status: 500 }
    );
  }
  if (!tenantRecord) {
    return NextResponse.json(
      {
        error: "Tenant not found",
        code: "ERR_TENANT_NOT_FOUND",
        correlationId,
      },
      { status: 404 }
    );
  }

  let blobCleanup:
    | Awaited<ReturnType<typeof deleteTenantBlobFolders>>
    | null = null;
  let vercelCleanup: VercelDeleteResult | null = null;
  let cloudflareCleanup:
    | Awaited<ReturnType<typeof deleteTenantCloudflareZones>>
    | { error: string; code: string }
    | null = null;
  let deleteEventId: string | null = null;

  const { data: insertedEvent, error: insertEventError } = await supabaseAdmin
    .from("tenant_delete_events")
    .insert({
      tenant_id: params.id,
      actor_user_id: auth.data.user.id,
      idempotency_key: idempotencyKey,
      status: "pending",
      correlation_id: correlationId,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertEventError) {
    const conflict = String((insertEventError as { code?: string }).code || "") === "23505";
    if (conflict) {
      return NextResponse.json(
        {
          error: "Delete already in progress for this idempotency key",
          code: "ERR_TENANT_DELETE_IN_PROGRESS",
          correlationId,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to initialize delete idempotency lock",
        code: "ERR_TENANT_DELETE_IDEMPOTENCY_INIT_FAILED",
        correlationId,
      },
      { status: 500 }
    );
  }
  deleteEventId = insertedEvent.id;

  try {
    vercelCleanup = await deleteVercelProjectForTenantStrict(tenantRecord);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel project delete failed";
    if (deleteEventId) {
      await supabaseAdmin
        .from("tenant_delete_events")
        .update({
          status: "error",
          error_code: "ERR_TENANT_VERCEL_DELETE_FAILED",
          error_message: message,
          http_status: 502,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deleteEventId);
    }
    return NextResponse.json(
      {
        error: message,
        code: "ERR_TENANT_VERCEL_DELETE_FAILED",
        correlationId,
      },
      { status: 502 }
    );
  }

  try {
    cloudflareCleanup = await deleteTenantCloudflareZones(params.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare cleanup failed";
    cloudflareCleanup = { error: message, code: "ERR_TENANT_CF_CLEANUP_FAILED" };
  }

  try {
    blobCleanup = await deleteTenantBlobFolders(params.id, tenantRecord.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blob cleanup failed";
    if (deleteEventId) {
      await supabaseAdmin
        .from("tenant_delete_events")
        .update({
          status: "error",
          error_code: "ERR_TENANT_BLOB_DELETE_FAILED",
          error_message: message,
          http_status: 500,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deleteEventId);
    }
    return NextResponse.json(
      {
        error: message,
        code: "ERR_TENANT_BLOB_DELETE_FAILED",
        correlationId,
      },
      { status: 500 }
    );
  }

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("delete_tenant_with_entitlement_release", {
    p_tenant_id: params.id,
  });
  if (rpcError) {
    const rpcCode = typeof (rpcError as { code?: unknown }).code === "string" ? (rpcError as { code: string }).code : null;
    const missingFunction = rpcCode === "PGRST202" || String(rpcError.message || "").includes("Could not find the function");
    const errorCode = missingFunction ? "ERR_TENANT_DELETE_MIGRATION_MISSING" : "ERR_TENANT_DELETE_TRANSACTION_FAILED";
    if (deleteEventId) {
      await supabaseAdmin
        .from("tenant_delete_events")
        .update({
          status: "error",
          error_code: errorCode,
          error_message: String(rpcError.message || "Failed to delete tenant transaction"),
          http_status: 500,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deleteEventId);
    }
    return NextResponse.json(
      {
        error: missingFunction
          ? "Delete tenant migration missing. Apply DB migration and retry."
          : "Failed to delete tenant transaction",
        code: errorCode,
        correlationId,
      },
      { status: 500 }
    );
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as DeleteTenantRpcRow | null;
  if (!row?.tenant_id) {
    if (deleteEventId) {
      await supabaseAdmin
        .from("tenant_delete_events")
        .update({
          status: "error",
          error_code: "ERR_TENANT_NOT_FOUND",
          error_message: "Tenant not found",
          http_status: 404,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deleteEventId);
    }
    return NextResponse.json(
      {
        error: "Tenant not found",
        code: "ERR_TENANT_NOT_FOUND",
        correlationId,
      },
      { status: 404 }
    );
  }

  const responsePayload = {
    correlationId,
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      deleted: true,
    },
    deleted: {
      deployments: Number(row.deployments_deleted ?? 0),
      entitlementsReleased: Number(row.entitlements_released ?? 0),
      vercel: vercelCleanup,
      blob: blobCleanup,
      cloudflare: cloudflareCleanup,
    },
  };

  if (deleteEventId) {
    await supabaseAdmin
      .from("tenant_delete_events")
      .update({
        status: "success",
        response_payload: responsePayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deleteEventId);
  }

  return NextResponse.json(responsePayload);
}
