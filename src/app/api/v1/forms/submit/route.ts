import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/githubAppClient";
import { resolveCorrelationId } from "@/lib/correlation";
import { logForm, metricForm } from "@/lib/formsTelemetry";
import { sendResendLeadEmail } from "@/lib/formsResend";
import { resolveTenantEmailTemplate } from "@/lib/formsEmailTemplates";
import { renderLeadNotificationEmail } from "@/lib/emails/LeadNotificationEmail";
import { renderLeadSenderConfirmationEmail } from "@/lib/emails/LeadSenderConfirmationEmail";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Correlation-Id",
};

const RATE_LIMIT_PER_MINUTE = Number(process.env.FORMS_RATE_LIMIT_PER_MINUTE ?? 5);
const GITHUB_RETRIES = Number(process.env.FORMS_GITHUB_RETRIES ?? 2);
const GITHUB_RETRY_BASE_MS = Number(process.env.FORMS_GITHUB_RETRY_BASE_MS ?? 250);

// Save2repo schema (per src/types/database.ts): `tenants` has no `api_key`,
// no `github_installation_id` (that lives on owner_integrations), no
// `forms_*` policy columns (save2repo is git+db only per ADR-005), and the
// display field is `display_name`. The forms/submit public auth uses a new
// per-tenant `public_form_key` (migration 20260525130000) generated at
// provision time and embedded in the tenant's Vite site as VITE_FORM_KEY.
type TenantRow = {
  id: string;
  display_name: string | null;
  slug: string;
  owner_user_id: string;
  github_owner_login: string | null;
  github_repo_name: string | null;
  public_form_key: string | null;
  vercel_url: string | null;
};

function parseBearerApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function getRequesterIp(req: NextRequest): string | null {
  const fromForwarded = req.headers.get("x-forwarded-for");
  if (fromForwarded) {
    const first = fromForwarded.split(",")[0]?.trim() ?? "";
    return first || null;
  }
  const fromReal = req.headers.get("x-real-ip");
  return fromReal?.trim() || null;
}

async function appendLeadEvent(params: {
  tenantId: string;
  leadId?: string | null;
  eventName: string;
  eventStatus: "success" | "error" | "pending" | "warning";
  correlationId: string;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from("lead_events").insert({
    tenant_id: params.tenantId,
    lead_id: params.leadId ?? null,
    event_name: params.eventName,
    event_status: params.eventStatus,
    correlation_id: params.correlationId,
    idempotency_key: params.idempotencyKey ?? null,
    payload: params.payload ?? {},
  });
}

async function isGithubRepoPrivate(params: {
  installationId: string;
  owner: string;
  repo: string;
}): Promise<boolean> {
  const octokit = await getInstallationOctokit(Number(params.installationId));
  const response = await octokit.rest.repos.get({
    owner: params.owner,
    repo: params.repo,
  });
  return Boolean(response.data.private);
}

async function withRetry<T>(fn: () => Promise<T>, retries = GITHUB_RETRIES, baseDelayMs = GITHUB_RETRY_BASE_MS): Promise<T> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error: any) {
      const status = Number(error?.status ?? 0);
      const retryable = status === 429 || status >= 500 || error?.name === "AbortError";
      if (!retryable || attempt >= retries) {
        throw error;
      }
      const backoff = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      attempt += 1;
    }
  }
  throw new Error("retry exhausted");
}

async function commitLeadToGithub(params: {
  tenant: TenantRow;
  installationId: string | null;
  leadPayload: Record<string, unknown>;
  correlationId: string;
}) {
  const owner = params.tenant.github_owner_login;
  const repo = params.tenant.github_repo_name;
  const installationId = params.installationId;
  if (!owner || !repo || !installationId) {
    throw Object.assign(new Error("Tenant repository is not configured"), {
      code: "ERR_GITHUB_REPO_NOT_CONFIGURED",
      status: 409,
    });
  }

  const octokit = await getInstallationOctokit(Number(installationId));
  const now = new Date();
  const stamp = now.toISOString().replaceAll(":", "").replaceAll("-", "").replace("T", "-").slice(0, 15);
  const filePath = `src/data/leads/${stamp}-${randomUUID()}.json`;
  const serialized = JSON.stringify(params.leadPayload, null, 2);
  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: "New lead from contact-form [skip ci]",
    content: Buffer.from(serialized).toString("base64"),
  });
  return {
    githubPath: filePath,
    githubCommitSha: response.data.commit?.sha ?? null,
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const apiKey = parseBearerApiKey(req);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? null;
  const sourceIp = getRequesterIp(req);
  const userAgent = req.headers.get("user-agent");

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing Bearer API key", code: "ERR_UNAUTHORIZED", correlationId },
      { status: 401, headers: corsHeaders }
    );
  }

  const body = await req.json().catch(() => ({}));
  const payload = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select(
      "id,display_name,slug,owner_user_id,github_owner_login,github_repo_name,public_form_key,vercel_url"
    )
    .eq("public_form_key", apiKey)
    .single<TenantRow>();

  if (tenantError || !tenant?.id) {
    return NextResponse.json(
      { error: "Invalid API key", code: "ERR_INVALID_API_KEY", correlationId },
      { status: 403, headers: corsHeaders }
    );
  }

  // Single-owner: github installation lives on owner_integrations.
  const { data: integRow } = await supabaseAdmin
    .from("owner_integrations")
    .select("github_installation_id")
    .eq("owner_user_id", tenant.owner_user_id)
    .maybeSingle<{ github_installation_id: number | null }>();
  const ownerGithubInstallationId: string | null = integRow?.github_installation_id
    ? String(integRow.github_installation_id)
    : null;

  if (idempotencyKey) {
    const replay = await supabaseAdmin
      .from("leads")
      .select("id, delivery_status, resend_id, storage_mode, correlation_id")
      .eq("tenant_id", tenant.id)
      .eq("idempotency_key", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (replay.data?.id) {
      return NextResponse.json(
        {
          correlationId,
          idempotentReplay: true,
          lead: replay.data,
        },
        { status: 200, headers: corsHeaders }
      );
    }
  }

  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  if (sourceIp) {
    const rateProbe = await supabaseAdmin
      .from("leads")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenant.id)
      .eq("source_ip", sourceIp)
      .gte("created_at", cutoff);
    if ((rateProbe.count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      await appendLeadEvent({
        tenantId: tenant.id,
        eventName: "form.submit.rate_limited",
        eventStatus: "warning",
        correlationId,
        idempotencyKey,
        payload: { sourceIp, count: rateProbe.count ?? 0, windowSeconds: 60 },
      });
      metricForm("form_submit_rate_limited", 1, { tenantId: tenant.id });
      return NextResponse.json(
        { error: "Too many submissions, retry in a minute", code: "ERR_FORM_RATE_LIMITED", correlationId },
        { status: 429, headers: corsHeaders }
      );
    }
  }

  const owner = await supabaseAdmin.auth.admin.getUserById(tenant.owner_user_id);
  const ownerEmail = owner.data.user?.email ?? null;
  const configuredRecipientEmail = normalizeEmail(payload.recipientEmail);
  const recipientEmail = configuredRecipientEmail ?? ownerEmail;
  const recipientSource = configuredRecipientEmail ? "payload_config" : "tenant_owner_fallback";
  if (!recipientEmail) {
    return NextResponse.json(
      { error: "Recipient email is missing", code: "ERR_RECIPIENT_EMAIL_MISSING", correlationId },
      { status: 409, headers: corsHeaders }
    );
  }

  const senderEmail = normalizeEmail(payload.email);

  let runtimeRepoPrivate = false;
  let runtimeRepoChecked = false;
  let runtimeRepoCheckError: string | null = null;
  const installationId = ownerGithubInstallationId;
  const repoOwner = tenant.github_owner_login;
  const repoName = tenant.github_repo_name;
  if (true /* save2repo: git+db only, ADR-005 */ && installationId && repoOwner && repoName) {
    try {
      runtimeRepoPrivate = await withRetry(() =>
        isGithubRepoPrivate({
          installationId,
          owner: repoOwner,
          repo: repoName,
        })
      );
      runtimeRepoChecked = true;
    } catch (error: any) {
      runtimeRepoCheckError = error?.message ?? "repo privacy check failed";
    }
  }

  // save2repo: storage policy is always git+db per ADR-005 (no Edge Config / hot save).
  let storageMode = "git_plus_db";
  let gitStorageAllowed = Boolean(true /* save2repo: git+db only, ADR-005 */);
  if (runtimeRepoChecked && !runtimeRepoPrivate) {
    gitStorageAllowed = false;
    storageMode = "db_only_public_repo";
  }
  if (runtimeRepoCheckError) {
    gitStorageAllowed = false;
    storageMode = "db_only_runtime_guardrail";
  }

  // save2repo: no forms_* columns on tenants; the runtime gate above already
  // forces storageMode to "db_only_public_repo" when the repo is public. The
  // parent's persisted policy flip is dropped — every request re-checks.

  const { data: insertedLead, error: insertError } = await supabaseAdmin
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      data: payload,
      source_ip: sourceIp,
      user_agent: userAgent ?? null,
      delivery_status: "received",
      storage_mode: storageMode,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
    })
    .select("id, delivery_status, storage_mode")
    .single();

  if (insertError || !insertedLead?.id) {
    return NextResponse.json(
      { error: "Failed to persist lead", code: "ERR_LEAD_INSERT_FAILED", correlationId },
      { status: 500, headers: corsHeaders }
    );
  }

  await appendLeadEvent({
    tenantId: tenant.id,
    leadId: insertedLead.id,
    eventName: "form.submit.accepted",
    eventStatus: "success",
    correlationId,
    idempotencyKey,
    payload: {
      sourceIp,
      runtimeRepoChecked,
      runtimeRepoPrivate,
      storageMode,
      recipientSource,
      recipientEmail,
    },
  });

  let partialSuccess = false;
  if (gitStorageAllowed) {
    try {
      const gitLeadPayload = {
        ...payload,
        _meta: {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          correlationId,
          submittedAt: new Date().toISOString(),
        },
      };
      const committed = await withRetry(() =>
        commitLeadToGithub({
          tenant,
          installationId: ownerGithubInstallationId,
          leadPayload: gitLeadPayload,
          correlationId,
        })
      );
      await supabaseAdmin
        .from("leads")
        .update({
          github_path: committed.githubPath,
          github_commit_sha: committed.githubCommitSha,
          updated_at: new Date().toISOString(),
        })
        .eq("id", insertedLead.id);
      await appendLeadEvent({
        tenantId: tenant.id,
        leadId: insertedLead.id,
        eventName: "form.storage.github.committed",
        eventStatus: "success",
        correlationId,
        payload: committed,
      });
    } catch (error: any) {
      partialSuccess = true;
      const message = error?.message ?? "GitHub storage failed";
      await supabaseAdmin
        .from("leads")
        .update({
          last_error_code: "ERR_GITHUB_STORAGE_FAILED",
          last_error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", insertedLead.id);
      await appendLeadEvent({
        tenantId: tenant.id,
        leadId: insertedLead.id,
        eventName: "form.storage.github.failed",
        eventStatus: "error",
        correlationId,
        payload: { message },
      });
      metricForm("form_storage_github_error", 1, { tenantId: tenant.id });
    }
  } else {
    await appendLeadEvent({
      tenantId: tenant.id,
      leadId: insertedLead.id,
      eventName: "form.storage.github.skipped",
      eventStatus: "warning",
      correlationId,
      payload: {
        storageMode,
        runtimeRepoChecked,
        runtimeRepoPrivate,
        runtimeRepoCheckError,
      },
    });
  }

  const tenantLabel = tenant.display_name || tenant.slug;
  const subject = `Nuovo contatto da ${tenantLabel}`;
  const notificationTemplate = await resolveTenantEmailTemplate({
    kind: "lead_notification",
    tenantRepo: {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      installationId: ownerGithubInstallationId,
      owner: tenant.github_owner_login,
      repo: tenant.github_repo_name,
      tenantBaseUrl: tenant.vercel_url,
    },
    context: {
      tenantName: tenantLabel,
      correlationId,
      replyTo: senderEmail,
      leadData: payload,
    },
    fallbackRender: () =>
      renderLeadNotificationEmail({
        tenantName: tenantLabel,
        correlationId,
        leadData: payload,
        replyTo: senderEmail,
      }),
  });
  const html = notificationTemplate.html;

  await appendLeadEvent({
    tenantId: tenant.id,
    leadId: insertedLead.id,
    eventName: "form.template.lead_notification.resolved",
    eventStatus: notificationTemplate.source === "tenant_repo" ? "success" : "warning",
    correlationId,
    payload: {
      source: notificationTemplate.source,
      templatePath: notificationTemplate.templatePath,
      cacheHit: notificationTemplate.cacheHit,
      errorCode: notificationTemplate.errorCode,
      errorMessage: notificationTemplate.errorMessage,
      resolvedBaseUrl: notificationTemplate.resolvedBaseUrl,
      rewrittenUrlCount: notificationTemplate.rewrittenUrlCount,
    },
  });

  try {
    const resendResult = await sendResendLeadEmail({
      to: recipientEmail,
      replyTo: senderEmail,
      subject,
      html,
    });

    await supabaseAdmin
      .from("leads")
      .update({
        resend_id: resendResult.id,
        delivery_status: "sent",
        updated_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("id", insertedLead.id);

    await appendLeadEvent({
      tenantId: tenant.id,
      leadId: insertedLead.id,
      eventName: "form.delivery.resend.sent",
      eventStatus: "success",
      correlationId,
      payload: { resendId: resendResult.id, recipientSource, recipientEmail },
    });
    if (senderEmail) {
      try {
        const senderConfirmationTemplate = await resolveTenantEmailTemplate({
          kind: "sender_confirmation",
          tenantRepo: {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            installationId: ownerGithubInstallationId,
            owner: tenant.github_owner_login,
            repo: tenant.github_repo_name,
            tenantBaseUrl: tenant.vercel_url,
          },
          context: {
            tenantName: tenantLabel,
            correlationId,
            replyTo: senderEmail,
            leadData: payload,
          },
          fallbackRender: () =>
            renderLeadSenderConfirmationEmail({
              tenantName: tenantLabel,
              correlationId,
              leadData: payload,
            }),
        });

        await appendLeadEvent({
          tenantId: tenant.id,
          leadId: insertedLead.id,
          eventName: "form.template.sender_confirmation.resolved",
          eventStatus: senderConfirmationTemplate.source === "tenant_repo" ? "success" : "warning",
          correlationId,
          payload: {
            source: senderConfirmationTemplate.source,
            templatePath: senderConfirmationTemplate.templatePath,
            cacheHit: senderConfirmationTemplate.cacheHit,
            errorCode: senderConfirmationTemplate.errorCode,
            errorMessage: senderConfirmationTemplate.errorMessage,
            resolvedBaseUrl: senderConfirmationTemplate.resolvedBaseUrl,
            rewrittenUrlCount: senderConfirmationTemplate.rewrittenUrlCount,
          },
        });

        const senderConfirmationSubject = `Conferma richiesta ricevuta - ${tenantLabel}`;
        const senderConfirmationResult = await sendResendLeadEmail({
          to: senderEmail,
          subject: senderConfirmationSubject,
          html: senderConfirmationTemplate.html,
        });

        await appendLeadEvent({
          tenantId: tenant.id,
          leadId: insertedLead.id,
          eventName: "form.delivery.sender_confirmation.sent",
          eventStatus: "success",
          correlationId,
          payload: { resendId: senderConfirmationResult.id, senderEmail },
        });
      } catch (error: any) {
        partialSuccess = true;
        const message = error?.message ?? "Sender confirmation delivery failed";
        const code = typeof error?.code === "string" ? error.code : "ERR_RESEND_SENDER_CONFIRMATION_FAILED";
        await appendLeadEvent({
          tenantId: tenant.id,
          leadId: insertedLead.id,
          eventName: "form.delivery.sender_confirmation.failed",
          eventStatus: "warning",
          correlationId,
          payload: { code, message, senderEmail },
        });
      }
    }

    metricForm("form_submit_success", 1, { tenantId: tenant.id, partialSuccess });
    logForm("info", "form.submit.completed", {
      tenantId: tenant.id,
      leadId: insertedLead.id,
      correlationId,
      partialSuccess,
      storageMode,
    });

    return NextResponse.json(
      {
        ok: true,
        correlationId,
        partialSuccess,
        lead: {
          id: insertedLead.id,
          deliveryStatus: "sent",
          resendId: resendResult.id,
          storageMode,
        },
      },
      { status: partialSuccess ? 202 : 200, headers: corsHeaders }
    );
  } catch (error: any) {
    const message = error?.message ?? "Resend delivery failed";
    const code = typeof error?.code === "string" ? error.code : "ERR_RESEND_SEND_FAILED";
    await supabaseAdmin
      .from("leads")
      .update({
        delivery_status: "error",
        last_error_code: code,
        last_error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", insertedLead.id);

    await supabaseAdmin.from("lead_dlq").insert({
      tenant_id: tenant.id,
      lead_id: insertedLead.id,
      operation: "resend_send",
      attempts: 1,
      last_error_code: code,
      last_error_message: message,
      payload: { correlationId, idempotencyKey },
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await appendLeadEvent({
      tenantId: tenant.id,
      leadId: insertedLead.id,
      eventName: "form.delivery.resend.failed",
      eventStatus: "error",
      correlationId,
      payload: { code, message },
    });

    metricForm("form_submit_error", 1, { tenantId: tenant.id, code });
    logForm("error", "form.submit.delivery_failed", {
      tenantId: tenant.id,
      leadId: insertedLead.id,
      correlationId,
      code,
    });

    return NextResponse.json(
      {
        ok: false,
        correlationId,
        error: "Lead saved but email delivery failed",
        code,
        lead: {
          id: insertedLead.id,
          deliveryStatus: "error",
          storageMode,
        },
      },
      { status: 502, headers: corsHeaders }
    );
  }
}

