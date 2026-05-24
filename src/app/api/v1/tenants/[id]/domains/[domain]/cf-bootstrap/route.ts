import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireRequestUser, assertTenantAccess } from "@/lib/serverAuth";
import {
  appendDomainEvent,
  assertDomainGovernance,
  enforceDomainMutationRateLimit,
  normalizeDomain,
  resolveCorrelationId,
} from "@/lib/customDomains";
import { createZone, findZoneByName, type CloudflareApiError } from "@/lib/cloudflareApi";
import { parseDomain } from "@/lib/domainParsing";
import { logDomain, metricDomain } from "@/lib/domainTelemetry";

export const dynamic = "force-dynamic";

type CfBootstrapPayload = {
  cf_zone_id: string;
  cf_status: "pending_ns" | "active";
  name_servers: string[];
};

type DomainRow = {
  id: string;
  domain: string;
  cf_zone_id: string | null;
  cf_status: string | null;
  cf_nameservers: string[] | null;
};

type EventRow = {
  id: string;
  event_status: "success" | "error" | "pending";
  payload: Record<string, unknown> | null;
};

function isCloudflareApiError(error: unknown): error is CloudflareApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; domain: string }> }
) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? null;

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: "Missing Idempotency-Key header",
        code: "ERR_CF_BOOTSTRAP_IDEMPOTENCY_REQUIRED",
        correlationId,
      },
      { status: 400 }
    );
  }

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const access = await assertTenantAccess({
    userId: auth.data.user.id,
    tenantId: params.id,
    requiredRole: "editor",
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.data.error, code: access.data.code, correlationId },
      { status: access.data.status }
    );
  }

  const governance = await assertDomainGovernance({ userId: auth.data.user.id, tenantId: params.id });
  if (!governance.ok) {
    return NextResponse.json(
      { error: governance.error, code: governance.code, correlationId },
      { status: governance.status }
    );
  }

  const rateLimit = await enforceDomainMutationRateLimit({ tenantId: params.id, userId: auth.data.user.id });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: rateLimit.error, code: rateLimit.code, correlationId },
      { status: rateLimit.status }
    );
  }

  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const supabaseAdmin = getSupabaseAdmin();

  const { data: domainRow, error: domainLookupError } = await supabaseAdmin
    .from("tenant_domains")
    .select("id, domain, cf_zone_id, cf_status, cf_nameservers")
    .eq("tenant_id", params.id)
    .eq("domain", domain)
    .is("deleted_at", null)
    .maybeSingle<DomainRow>();

  if (domainLookupError) {
    return NextResponse.json(
      { error: "Failed to lookup tenant domain", code: "ERR_DOMAIN_LOOKUP_FAILED", correlationId },
      { status: 500 }
    );
  }
  if (!domainRow?.id) {
    return NextResponse.json(
      { error: "Domain not found for tenant", code: "ERR_DOMAIN_NOT_FOUND", correlationId },
      { status: 404 }
    );
  }

  const { data: previousEvent } = await supabaseAdmin
    .from("tenant_domain_events")
    .select("id, event_status, payload")
    .eq("tenant_id", params.id)
    .eq("actor_user_id", auth.data.user.id)
    .eq("event_name", "cf_bootstrap")
    .eq("idempotency_key", idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<EventRow>();

  if (previousEvent?.event_status === "success" && previousEvent.payload) {
    return NextResponse.json({
      correlationId,
      idempotentReplay: true,
      ...(previousEvent.payload as CfBootstrapPayload),
    });
  }
  if (previousEvent?.event_status === "pending") {
    return NextResponse.json(
      {
        error: "CF bootstrap already in progress for this idempotency key",
        code: "ERR_CF_BOOTSTRAP_IN_PROGRESS",
        correlationId,
      },
      { status: 409 }
    );
  }

  // Reconnect path: domain has cf_zone_id but was disconnected. Re-attach without creating a new zone.
  if (domainRow.cf_zone_id && domainRow.cf_status === "disconnected") {
    const { error: reattachError } = await supabaseAdmin
      .from("tenant_domains")
      .update({
        cf_status: "pending_ns",
        cf_zone_status_checked_at: new Date().toISOString(),
        cf_last_error_code: null,
        cf_last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", domainRow.id);
    if (reattachError) {
      return NextResponse.json(
        {
          error: "Failed to re-attach Cloudflare",
          code: "ERR_CF_REATTACH_FAILED",
          correlationId,
        },
        { status: 500 }
      );
    }
    const reattachPayload: CfBootstrapPayload = {
      cf_zone_id: domainRow.cf_zone_id,
      cf_status: "pending_ns",
      name_servers: domainRow.cf_nameservers ?? [],
    };
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: domainRow.id,
      actorUserId: auth.data.user.id,
      eventName: "cf_bootstrap",
      eventStatus: "success",
      correlationId,
      idempotencyKey,
      payload: { ...reattachPayload, mode: "reattach" } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ correlationId, ...reattachPayload, mode: "reattach" });
  }

  if (domainRow.cf_zone_id) {
    return NextResponse.json(
      {
        error: "Cloudflare zone already attached to this domain",
        code: "ERR_CF_ALREADY_BOOTSTRAPPED",
        correlationId,
        cf_zone_id: domainRow.cf_zone_id,
        cf_status: domainRow.cf_status,
        name_servers: domainRow.cf_nameservers ?? [],
      },
      { status: 409 }
    );
  }

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: domainRow.id,
    actorUserId: auth.data.user.id,
    eventName: "cf_bootstrap",
    eventStatus: "pending",
    correlationId,
    idempotencyKey,
    payload: { domain },
  });

  const parsed = parseDomain(domain);

  let zone;
  let adoptionMode: "create" | "adopt" | "adopt-parent" = "create";

  if (parsed.isSubdomain) {
    // Subdomain path: parent zone MUST already be in this account. We never
    // create a parent zone implicitly.
    let parent;
    try {
      parent = await findZoneByName(parsed.apex);
    } catch {
      parent = null;
    }
    if (!parent) {
      const code = "ERR_CF_PARENT_ZONE_NOT_FOUND";
      const message = `Parent zone "${parsed.apex}" is not on Cloudflare in your account. Move "${parsed.apex}" to Cloudflare first as an apex, or use a different domain.`;
      await supabaseAdmin
        .from("tenant_domains")
        .update({
          cf_status: "error",
          cf_last_error_code: code,
          cf_last_error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", domainRow.id);
      await appendDomainEvent({
        tenantId: params.id,
        tenantDomainId: domainRow.id,
        actorUserId: auth.data.user.id,
        eventName: "cf_bootstrap",
        eventStatus: "error",
        correlationId,
        idempotencyKey,
        payload: { code, message, apex: parsed.apex },
      });
      logDomain("error", "cf.bootstrap.parent_missing", { tenantId: params.id, domain, apex: parsed.apex, correlationId });
      metricDomain("cf_bootstrap_failed", 1, { code });
      return NextResponse.json({ error: message, code, correlationId, apex: parsed.apex }, { status: 409 });
    }
    zone = parent;
    adoptionMode = "adopt-parent";
  } else {
    // Apex path: try adopt first to avoid requiring Account > Zone > Edit; fall back to create.
    try {
      const existing = await findZoneByName(parsed.fqdn);
      if (existing) {
        zone = existing;
        adoptionMode = "adopt";
      }
    } catch {
      // Lookup failure (e.g. token lacks Zone Read on this account): fall back to createZone.
    }
  }

  if (!zone) {
    try {
      zone = await createZone(parsed.fqdn);
    } catch (error: unknown) {
      const cfError = isCloudflareApiError(error) ? error : null;
      const code = cfError?.code ?? "ERR_CF_BOOTSTRAP_FAILED";
      const message = cfError?.message ?? "Cloudflare zone create failed";
      const status = cfError?.status && cfError.status >= 400 ? cfError.status : 502;

    await supabaseAdmin
      .from("tenant_domains")
      .update({
        cf_status: "error",
        cf_last_error_code: code,
        cf_last_error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", domainRow.id);

    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: domainRow.id,
      actorUserId: auth.data.user.id,
      eventName: "cf_bootstrap",
      eventStatus: "error",
      correlationId,
      idempotencyKey,
      payload: { code, message },
    });

    logDomain("error", "cf.bootstrap.failed", { tenantId: params.id, domain, code, correlationId });
    metricDomain("cf_bootstrap_failed", 1, { code });

      return NextResponse.json({ error: message, code, correlationId }, { status });
    }
  }

  const nameServers = zone.name_servers ?? [];
  const cfStatus: CfBootstrapPayload["cf_status"] = zone.status === "active" ? "active" : "pending_ns";

  const { error: updateError } = await supabaseAdmin
    .from("tenant_domains")
    .update({
      cf_zone_id: zone.id,
      cf_zone_apex: parsed.apex,
      cf_nameservers: nameServers,
      cf_status: cfStatus,
      cf_zone_status_checked_at: new Date().toISOString(),
      cf_attached_at: new Date().toISOString(),
      cf_last_error_code: null,
      cf_last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", domainRow.id);

  if (updateError) {
    await appendDomainEvent({
      tenantId: params.id,
      tenantDomainId: domainRow.id,
      actorUserId: auth.data.user.id,
      eventName: "cf_bootstrap",
      eventStatus: "error",
      correlationId,
      idempotencyKey,
      payload: { code: "ERR_CF_BOOTSTRAP_PERSIST_FAILED", message: updateError.message },
    });
    return NextResponse.json(
      {
        error: "CF bootstrap succeeded on Cloudflare but persistence failed",
        code: "ERR_CF_BOOTSTRAP_PERSIST_FAILED",
        correlationId,
        cf_zone_id: zone.id,
      },
      { status: 500 }
    );
  }

  const responsePayload: CfBootstrapPayload = {
    cf_zone_id: zone.id,
    cf_status: cfStatus,
    name_servers: nameServers,
  };

  await appendDomainEvent({
    tenantId: params.id,
    tenantDomainId: domainRow.id,
    actorUserId: auth.data.user.id,
    eventName: "cf_bootstrap",
    eventStatus: "success",
    correlationId,
    idempotencyKey,
    payload: { ...responsePayload, mode: adoptionMode } as unknown as Record<string, unknown>,
  });

  logDomain("info", "cf.bootstrap.success", {
    tenantId: params.id,
    domain,
    cf_zone_id: zone.id,
    mode: adoptionMode,
    correlationId,
  });
  metricDomain("cf_bootstrap_success", 1, { mode: adoptionMode });

  return NextResponse.json({ correlationId, ...responsePayload, mode: adoptionMode });
}
