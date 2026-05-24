import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireDomainsAdmin } from "@/lib/internalAdmin";
import { vercelAddDomain, vercelGetDomainConfig, vercelGetDomainStatus, vercelRemoveDomain, vercelVerifyDomain } from "@/lib/vercelDomains";
import { extractVerificationTargets } from "@/lib/customDomains";

export const dynamic = "force-dynamic";

function deriveDomainStatus(vercelPayload: any, checksCount: number): string {
  const verified = Boolean(vercelPayload?.verified);
  const ownershipConflict = Array.isArray(vercelPayload?.config?.conflicts) && vercelPayload.config.conflicts.length > 0;
  if (ownershipConflict) return "conflict";
  if (verified) return "active";
  if (checksCount > 0) return "verifying";
  return "verifying";
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const admin = await requireDomainsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error, code: admin.code }, { status: admin.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: dlq, error: dlqError } = await supabaseAdmin
    .from("tenant_domain_dlq")
    .select("id, tenant_id, tenant_domain_id, operation, domain, attempts, resolved_at")
    .eq("id", id)
    .maybeSingle();

  if (dlqError) {
    return NextResponse.json({ error: "Failed to load DLQ item", code: "ERR_DOMAIN_DLQ_ITEM_READ_FAILED" }, { status: 500 });
  }
  if (!dlq?.id) {
    return NextResponse.json({ error: "DLQ item not found", code: "ERR_DOMAIN_DLQ_NOT_FOUND" }, { status: 404 });
  }
  if (dlq.resolved_at) {
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("vercel_project_id")
    .eq("id", dlq.tenant_id)
    .maybeSingle();
  const projectId = tenant?.vercel_project_id ?? null;
  if (!projectId) {
    return NextResponse.json({ error: "Missing tenant Vercel project", code: "ERR_VERCEL_PROJECT_MISSING" }, { status: 409 });
  }

  try {
    if (dlq.operation === "add_domain") {
      await vercelAddDomain(projectId, dlq.domain);
      const statusPayload = await vercelGetDomainStatus(projectId, dlq.domain);
      const configPayload = await vercelGetDomainConfig(projectId, dlq.domain).catch(() => null);
      const providerPayload = { ...statusPayload, config: configPayload };
      const verificationTargets = extractVerificationTargets({
        domain: dlq.domain,
        verificationPayload: providerPayload,
      });
      await supabaseAdmin
        .from("tenant_domains")
        .update({
          status: deriveDomainStatus(providerPayload, verificationTargets.checks.length),
          verification_targets: verificationTargets,
          last_vercel_payload: providerPayload,
          last_error_code: null,
          last_error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dlq.tenant_domain_id);
    } else if (dlq.operation === "remove_domain") {
      await vercelRemoveDomain(projectId, dlq.domain);
      await supabaseAdmin
        .from("tenant_domains")
        .update({
          status: "deleted",
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", dlq.tenant_domain_id);
    } else {
      await vercelVerifyDomain(projectId, dlq.domain).catch(() => null);
      const statusPayload = await vercelGetDomainStatus(projectId, dlq.domain);
      const configPayload = await vercelGetDomainConfig(projectId, dlq.domain).catch(() => null);
      const providerPayload = { ...statusPayload, config: configPayload };
      const verificationTargets = extractVerificationTargets({
        domain: dlq.domain,
        verificationPayload: providerPayload,
      });
      await supabaseAdmin
        .from("tenant_domains")
        .update({
          status: deriveDomainStatus(providerPayload, verificationTargets.checks.length),
          verification_targets: verificationTargets,
          last_vercel_payload: providerPayload,
          last_error_code: null,
          last_error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dlq.tenant_domain_id);
    }

    await supabaseAdmin
      .from("tenant_domain_dlq")
      .update({
        resolved_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        attempts: Number(dlq.attempts ?? 0) + 1,
      })
      .eq("id", dlq.id);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    await supabaseAdmin
      .from("tenant_domain_dlq")
      .update({
        attempts: Number(dlq.attempts ?? 0) + 1,
        last_error_code: typeof error?.code === "string" ? error.code : "ERR_DOMAIN_DLQ_RETRY_FAILED",
        last_error_message: typeof error?.message === "string" ? error.message : "Retry failed",
        last_attempt_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .eq("id", dlq.id);

    return NextResponse.json(
      {
        error: typeof error?.message === "string" ? error.message : "Retry failed",
        code: typeof error?.code === "string" ? error.code : "ERR_DOMAIN_DLQ_RETRY_FAILED",
      },
      { status: typeof error?.status === "number" ? error.status : 500 }
    );
  }
}
