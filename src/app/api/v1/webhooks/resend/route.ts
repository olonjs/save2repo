import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logForm, metricForm } from "@/lib/formsTelemetry";
import { resolveResendEventInfo, verifyResendWebhookSignature } from "@/lib/formsResend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET is missing", code: "ERR_RESEND_WEBHOOK_CONFIG_MISSING" },
      { status: 500 }
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  const valid = verifyResendWebhookSignature({
    secret,
    svixId,
    svixTimestamp,
    svixSignature,
    rawBody,
  });

  if (!valid) {
    metricForm("resend_webhook_signature_failed", 1, {});
    return NextResponse.json(
      { error: "Invalid webhook signature", code: "ERR_RESEND_WEBHOOK_SIGNATURE_INVALID" },
      { status: 401 }
    );
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload", code: "ERR_RESEND_WEBHOOK_JSON_INVALID" },
      { status: 400 }
    );
  }
  const eventInfo = resolveResendEventInfo(payload, req.headers);
  const supabaseAdmin = getSupabaseAdmin();

  const insertWebhookEvent = await supabaseAdmin
    .from("lead_webhook_events")
    .insert({
      webhook_event_key: eventInfo.webhookEventKey,
      resend_id: eventInfo.resendId,
      event_type: eventInfo.eventType,
      delivery_status: eventInfo.mappedStatus,
      payload,
      processed_at: null,
    })
    .select("id")
    .maybeSingle();

  if (insertWebhookEvent.error) {
    if (insertWebhookEvent.error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json(
      { error: "Failed to persist webhook event", code: "ERR_RESEND_WEBHOOK_INSERT_FAILED" },
      { status: 500 }
    );
  }

  let leadId: string | null = null;
  let tenantId: string | null = null;

  if (eventInfo.resendId && eventInfo.mappedStatus) {
    const updated = await supabaseAdmin
      .from("leads")
      .update({
        delivery_status: eventInfo.mappedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("resend_id", eventInfo.resendId)
      .select("id, tenant_id")
      .limit(1)
      .maybeSingle();

    if (updated.data?.id) {
      leadId = updated.data.id;
      tenantId = updated.data.tenant_id;

      await supabaseAdmin.from("lead_events").insert({
        tenant_id: updated.data.tenant_id,
        lead_id: updated.data.id,
        event_name: `resend.${eventInfo.eventType}`,
        event_status: eventInfo.mappedStatus === "error" ? "error" : eventInfo.mappedStatus === "warning" ? "warning" : "success",
        correlation_id: eventInfo.webhookEventKey,
        payload,
      });

      metricForm("resend_webhook_processed", 1, {
        tenantId: updated.data.tenant_id,
        status: eventInfo.mappedStatus,
      });
    }
  }

  await supabaseAdmin
    .from("lead_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
    })
    .eq("id", insertWebhookEvent.data?.id ?? "");

  logForm("info", "resend.webhook.processed", {
    eventType: eventInfo.eventType,
    resendId: eventInfo.resendId,
    webhookEventKey: eventInfo.webhookEventKey,
    tenantId,
    leadId,
  });

  return NextResponse.json({
    ok: true,
    eventType: eventInfo.eventType,
    resendId: eventInfo.resendId,
    status: eventInfo.mappedStatus,
  });
}
