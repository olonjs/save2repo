import { z } from "zod";

export type CloudflareCredentials = {
  apiToken: string;
  accountId: string;
};

export function resolveCloudflareCredentials(): CloudflareCredentials {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!apiToken) {
    throw new Error("ERR_CF_TOKEN_MISSING: CLOUDFLARE_API_TOKEN env var is not set");
  }
  if (!accountId) {
    throw new Error("ERR_CF_ACCOUNT_MISSING: CLOUDFLARE_ACCOUNT_ID env var is not set");
  }
  return { apiToken, accountId };
}

export type CloudflareApiError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  raw?: unknown;
};

type RetryOptions = {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
};

const DEFAULT_RETRIES = Number(process.env.CLOUDFLARE_RETRIES ?? 3);
const DEFAULT_TIMEOUT_MS = Number(process.env.CLOUDFLARE_TIMEOUT_MS ?? 10_000);
const DEFAULT_BASE_DELAY_MS = Number(process.env.CLOUDFLARE_RETRY_BASE_MS ?? 300);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapCloudflareError(status: number, data: unknown): CloudflareApiError {
  const errors = (data as { errors?: Array<{ code?: number; message?: string }> })?.errors ?? [];
  const firstError = errors[0];
  const apiCode = firstError?.code != null ? String(firstError.code) : "CF_UNKNOWN";
  const message = firstError?.message ?? `Cloudflare API failed with ${status}`;

  if (status === 429) {
    return { status, code: "ERR_CF_RATE_LIMITED", message, retryable: true, raw: data };
  }
  if (status >= 500) {
    return { status, code: "ERR_CF_UPSTREAM_5XX", message, retryable: true, raw: data };
  }
  if (status === 409 || apiCode === "1061") {
    return { status: 409, code: "ERR_CF_ZONE_CONFLICT", message, retryable: false, raw: data };
  }
  if (status === 404) {
    return { status, code: "ERR_CF_NOT_FOUND", message, retryable: false, raw: data };
  }
  if (status === 401 || status === 403) {
    return { status, code: "ERR_CF_FORBIDDEN", message, retryable: false, raw: data };
  }
  return {
    status,
    code: status >= 400 && status < 500 ? "ERR_CF_UPSTREAM_4XX" : "ERR_CF_UPSTREAM",
    message,
    retryable: false,
    raw: data,
  };
}

async function cfFetch<T>(path: string, init: RequestInit, retryOptions: RetryOptions = {}): Promise<T> {
  const { apiToken } = resolveCloudflareCredentials();
  const retries = retryOptions.retries ?? DEFAULT_RETRIES;
  const timeoutMs = retryOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const url = `https://api.cloudflare.com/client/v4${path}`;

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const mapped = mapCloudflareError(response.status, data);
        if (mapped.retryable && attempt < retries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          attempt += 1;
          continue;
        }
        throw mapped;
      }
      return data as T;
    } catch (error: unknown) {
      const isAbort = (error as { name?: string })?.name === "AbortError";
      const mapped: CloudflareApiError = isAbort
        ? {
            status: 504,
            code: "ERR_CF_TIMEOUT",
            message: `Cloudflare request timed out after ${timeoutMs}ms`,
            retryable: true,
          }
        : (error as CloudflareApiError);

      if (mapped.retryable && attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }
      throw mapped;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw {
    status: 500,
    code: "ERR_CF_RETRY_EXHAUSTED",
    message: "Cloudflare request exhausted retries",
    retryable: false,
  } satisfies CloudflareApiError;
}

// --- Zone types & operations ---

const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  name_servers: z.array(z.string()).optional(),
});

const ZoneEnvelopeSchema = z.object({
  result: ZoneSchema,
});

export type CloudflareZone = z.infer<typeof ZoneSchema>;

export async function createZone(domain: string): Promise<CloudflareZone> {
  const { accountId } = resolveCloudflareCredentials();
  const body = JSON.stringify({ name: domain, account: { id: accountId }, type: "full" });
  const data = await cfFetch<unknown>("/zones", { method: "POST", body });
  return ZoneEnvelopeSchema.parse(data).result;
}

const ZoneListEnvelopeSchema = z.object({
  result: z.array(
    ZoneSchema.extend({
      account: z.object({ id: z.string() }).optional(),
    })
  ),
});

export async function findZoneByName(domain: string): Promise<CloudflareZone | null> {
  const { accountId } = resolveCloudflareCredentials();
  const data = await cfFetch<unknown>(
    `/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
  const parsed = ZoneListEnvelopeSchema.parse(data);
  const match = parsed.result.find((z) => z.name.toLowerCase() === domain.toLowerCase());
  if (!match) return null;
  return { id: match.id, name: match.name, status: match.status, name_servers: match.name_servers };
}

export async function getZone(zoneId: string): Promise<CloudflareZone> {
  const data = await cfFetch<unknown>(`/zones/${encodeURIComponent(zoneId)}`, { method: "GET" });
  return ZoneEnvelopeSchema.parse(data).result;
}

export async function deleteZone(zoneId: string): Promise<{ id: string }> {
  const data = await cfFetch<unknown>(`/zones/${encodeURIComponent(zoneId)}`, { method: "DELETE" });
  return z.object({ result: z.object({ id: z.string() }) }).parse(data).result;
}

// --- DNS record types & operations ---

const DnsRecordSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  ttl: z.number(),
  proxied: z.boolean().optional(),
  proxiable: z.boolean().optional(),
  priority: z.number().optional(),
  locked: z.boolean().optional(),
});

const DnsListEnvelopeSchema = z.object({
  result: z.array(DnsRecordSchema),
});

const DnsRecordEnvelopeSchema = z.object({
  result: DnsRecordSchema,
});

export type CloudflareDnsRecord = z.infer<typeof DnsRecordSchema>;

export const DnsRecordInputSchema = z.object({
  type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]),
  name: z.string().min(1),
  content: z.string().min(1),
  ttl: z.number().int().min(1).default(1),
  proxied: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export type CloudflareDnsRecordInput = z.infer<typeof DnsRecordInputSchema>;

export async function listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]> {
  const data = await cfFetch<unknown>(
    `/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=500`,
    { method: "GET" }
  );
  return DnsListEnvelopeSchema.parse(data).result;
}

export async function createDnsRecord(
  zoneId: string,
  input: CloudflareDnsRecordInput
): Promise<CloudflareDnsRecord> {
  const parsed = DnsRecordInputSchema.parse(input);
  const data = await cfFetch<unknown>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
  return DnsRecordEnvelopeSchema.parse(data).result;
}

export async function updateDnsRecord(
  zoneId: string,
  recordId: string,
  patch: Partial<CloudflareDnsRecordInput>
): Promise<CloudflareDnsRecord> {
  const data = await cfFetch<unknown>(
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
  return DnsRecordEnvelopeSchema.parse(data).result;
}

export async function deleteDnsRecord(
  zoneId: string,
  recordId: string
): Promise<{ id: string }> {
  const data = await cfFetch<unknown>(
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    { method: "DELETE" }
  );
  return z.object({ result: z.object({ id: z.string() }) }).parse(data).result;
}
