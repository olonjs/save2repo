import { createHmac, randomUUID } from "crypto";

export type ResendSendResult = {
  id: string;
};

export type ResendMappedDeliveryStatus = "sent" | "delivered" | "warning" | "error" | null;

export type ResendEventInfo = {
  eventType: string;
  resendId: string | null;
  mappedStatus: ResendMappedDeliveryStatus;
  webhookEventKey: string;
};

type RetryOptions = {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
};

const DEFAULT_RETRIES = Number(process.env.RESEND_API_RETRIES ?? 2);
const DEFAULT_TIMEOUT_MS = Number(process.env.RESEND_API_TIMEOUT_MS ?? 10_000);
const DEFAULT_BASE_DELAY_MS = Number(process.env.RESEND_API_RETRY_BASE_MS ?? 250);
const DEFAULT_WEBHOOK_TOLERANCE_MS = Number(process.env.RESEND_WEBHOOK_TOLERANCE_MS ?? 5 * 60 * 1000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hasRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function resendFetch(path: string, init: RequestInit, retryOptions: RetryOptions = {}) {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw Object.assign(new Error("RESEND_API_KEY is missing"), {
      code: "ERR_RESEND_CONFIG_MISSING",
      status: 500,
      retryable: false,
    });
  }

  const retries = retryOptions.retries ?? DEFAULT_RETRIES;
  const timeoutMs = retryOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://api.resend.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.message ?? data?.error ?? `Resend API failed with ${response.status}`;
        const retryable = hasRetryableStatus(response.status);
        if (retryable && attempt < retries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          attempt += 1;
          continue;
        }
        throw Object.assign(new Error(message), {
          code: "ERR_RESEND_API_FAILED",
          status: response.status,
          retryable,
          raw: data,
        });
      }
      return data;
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      const retryable = isTimeout || Boolean(error?.retryable);
      if (retryable && attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }
      if (isTimeout) {
        throw Object.assign(new Error(`Resend request timed out after ${timeoutMs}ms`), {
          code: "ERR_RESEND_TIMEOUT",
          status: 504,
          retryable: false,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw Object.assign(new Error("Resend retries exhausted"), {
    code: "ERR_RESEND_RETRY_EXHAUSTED",
    status: 500,
    retryable: false,
  });
}

export async function sendResendLeadEmail(params: {
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
}): Promise<ResendSendResult> {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  if (!fromEmail) {
    throw Object.assign(new Error("RESEND_FROM_EMAIL is missing"), {
      code: "ERR_RESEND_CONFIG_MISSING",
      status: 500,
      retryable: false,
    });
  }

  const payload: Record<string, unknown> = {
    from: fromEmail,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  };
  if (params.replyTo) {
    payload.reply_to = params.replyTo;
  }

  const response = await resendFetch("/emails", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const id = typeof response?.id === "string" ? response.id : null;
  if (!id) {
    throw Object.assign(new Error("Resend response missing email id"), {
      code: "ERR_RESEND_RESPONSE_INVALID",
      status: 502,
      retryable: false,
      raw: response,
    });
  }
  return { id };
}

function readSignatureCandidates(rawSignatureHeader: string | null): string[] {
  if (!rawSignatureHeader) return [];
  return rawSignatureHeader
    .split(" ")
    .flatMap((token) => token.split(","))
    .map((token) => token.trim())
    .filter((token) => token.startsWith("v1,"))
    .map((token) => token.slice(3));
}

export function verifyResendWebhookSignature(params: {
  secret: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  rawBody: string;
}) {
  const { secret, svixId, svixTimestamp, svixSignature, rawBody } = params;
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;
  const timestampNumber = Number(svixTimestamp);
  if (!Number.isFinite(timestampNumber) || timestampNumber <= 0) return false;
  const ageMs = Math.abs(Date.now() - timestampNumber * 1000);
  if (ageMs > DEFAULT_WEBHOOK_TOLERANCE_MS) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const digest = createHmac("sha256", secret).update(signedContent).digest("base64");
  const candidates = readSignatureCandidates(svixSignature);
  return candidates.some((candidate) => timingSafeCompare(candidate, digest));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function mapResendDeliveryStatus(eventType: string): ResendMappedDeliveryStatus {
  const normalized = eventType.trim().toLowerCase();
  if (normalized === "email.sent") return "sent";
  if (normalized === "email.delivered") return "delivered";
  if (normalized === "email.bounced") return "error";
  if (normalized === "email.complaint") return "warning";
  return null;
}

export function resolveResendEventInfo(payload: any, headers: Headers): ResendEventInfo {
  const eventType =
    normalizeString(payload?.type) ??
    normalizeString(payload?.event) ??
    normalizeString(payload?.data?.type) ??
    "unknown";

  const resendId =
    normalizeString(payload?.data?.email_id) ??
    normalizeString(payload?.data?.id) ??
    normalizeString(payload?.data?.email?.id) ??
    normalizeString(payload?.email_id) ??
    null;

  const svixId = headers.get("svix-id");
  const webhookEventKey =
    normalizeString(svixId) ??
    normalizeString(payload?.id) ??
    `${eventType}:${resendId ?? "no_resend_id"}:${randomUUID()}`;

  return {
    eventType,
    resendId,
    mappedStatus: mapResendDeliveryStatus(eventType),
    webhookEventKey,
  };
}
