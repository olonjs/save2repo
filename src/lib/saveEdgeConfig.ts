import { logSaveWarn } from "@/lib/saveTelemetry";

export type HotEntityType = "page" | "config";

export class EdgeConfigError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "EdgeConfigError";
    this.code = code;
    this.status = status;
  }
}

function assertConfig() {
  const token = process.env.VERCEL_AUTH_TOKEN?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !teamId) {
    throw new EdgeConfigError("ERR_EDGE_CONFIG_NOT_CONFIGURED", "Vercel credentials are not configured", 500);
  }
  return { token, teamId };
}

export function resolveRuntimeEdgeConfigId(): string {
  const connection = process.env.EDGE_CONFIG?.trim() ?? "";
  if (!connection) {
    throw new EdgeConfigError(
      "ERR_EDGE_CONFIG_CONNECTION_MISSING",
      "EDGE_CONFIG is required for save2 routes",
      500
    );
  }

  // Typical connection string: https://edge-config.vercel.com/ecfg_xxx?token=...
  const fromRegex = connection.match(/(ecfg_[a-zA-Z0-9]+)/)?.[1];
  if (fromRegex) return fromRegex;

  try {
    const parsed = new URL(connection);
    const segment = parsed.pathname
      .split("/")
      .map((chunk) => chunk.trim())
      .find((chunk) => /^ecfg_[a-zA-Z0-9]+$/.test(chunk));
    if (segment) return segment;
  } catch {
    // no-op: handled by error below
  }

  throw new EdgeConfigError(
    "ERR_EDGE_CONFIG_ID_PARSE_FAILED",
    "Unable to extract edge config id (ecfg_...) from EDGE_CONFIG",
    500
  );
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

export function edgeNamespaceFromTenantId(tenantId: string): string {
  return `t_${normalizeToken(tenantId).slice(0, 40)}`;
}

function buildEdgeKey(type: HotEntityType, slug: string, namespace: string): string {
  const normalized = slug
    .trim().toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  // Vercel Edge key rules: alphanumeric + "_" + "-" only, max 256 chars.
  const safeNamespace = normalizeToken(namespace).slice(0, 50) || "t_default";
  if (type === "config") return `${safeNamespace}_config_site`;
  const maxSlugLen = Math.max(1, 250 - safeNamespace.length);
  const safeSlug = (normalized || "home").slice(0, maxSlugLen);
  return `${safeNamespace}_page_${safeSlug}`;
}

export function mapHotKey(type: HotEntityType, slug: string, namespace: string): string {
  return buildEdgeKey(type, slug, namespace);
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

async function parseJsonAnySafe(res: Response): Promise<unknown> {
  return await res.json().catch(() => ({}));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const asSeconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(retryAfter);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

function shouldRetryEdgeRead(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export async function upsertEdgeItem(params: {
  edgeConfigId: string;
  type: HotEntityType;
  slug: string;
  namespace: string;
  data: unknown;
}) {
  const { token, teamId } = assertConfig();
  const key = buildEdgeKey(params.type, params.slug, params.namespace);
  const endpoint = `https://api.vercel.com/v1/edge-config/${encodeURIComponent(params.edgeConfigId)}/items?teamId=${encodeURIComponent(teamId)}`;
  const payload = {
    items: [{ operation: "upsert", key, value: params.data }],
  };
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await parseJsonSafe(res);
    const message = ((body.error as { message?: string } | undefined)?.message ?? `Edge write failed (${res.status})`) as string;
    throw new EdgeConfigError("ERR_EDGE_WRITE_FAILED", message, res.status);
  }
  return { key };
}

export async function readAllEdgeItems(
  edgeConfigId: string,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<Array<{ key: string; value: unknown }>> {
  const { token, teamId } = assertConfig();
  const endpoint = `https://api.vercel.com/v1/edge-config/${encodeURIComponent(edgeConfigId)}/items?teamId=${encodeURIComponent(teamId)}`;
  const maxAttempts = Math.max(0, options?.maxAttempts ?? 2);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 250);
  let attempt = 0;

  while (true) {
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (res.ok) {
      const body = await parseJsonAnySafe(res);
      const items = Array.isArray(body)
        ? body
        : Array.isArray((body as { items?: unknown[] }).items)
          ? (body as { items: unknown[] }).items
          : [];
      return items
        .map((raw) => {
          const row = raw as { key?: unknown; value?: unknown };
          if (typeof row.key !== "string") return null;
          return { key: row.key, value: row.value };
        })
        .filter((it): it is { key: string; value: unknown } => it !== null);
    }

    const body = await parseJsonSafe(res);
    const message = ((body.error as { message?: string } | undefined)?.message ?? `Edge read failed (${res.status})`) as string;
    const canRetry = shouldRetryEdgeRead(res.status) && attempt < maxAttempts;
    if (!canRetry) {
      const code = res.status === 429 ? "ERR_EDGE_READ_RATE_LIMITED" : "ERR_EDGE_READ_FAILED";
      throw new EdgeConfigError(code, message, res.status);
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const exponential = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(baseDelayMs / 2)));
    const delayMs = retryAfterMs != null ? retryAfterMs : exponential + jitter;
    attempt += 1;
    await sleep(delayMs);
  }
}

export async function createEdgeConfig(params: { slug: string }): Promise<{ id: string }> {
  const { token, teamId } = assertConfig();
  const endpoint = `https://api.vercel.com/v1/edge-config?teamId=${encodeURIComponent(teamId)}`;
  const body = {
    slug: `jp-${params.slug}`,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || typeof data.id !== "string") {
    const message = ((data.error as { message?: string } | undefined)?.message ?? `Edge config create failed (${res.status})`) as string;
    throw new EdgeConfigError("ERR_EDGE_CONFIG_CREATE_FAILED", message, res.status);
  }
  return { id: data.id };
}

export async function ensureEdgeConfigId(params: {
  existingId: string | null | undefined;
  tenantSlug: string;
}): Promise<string> {
  const defaultEdgeConfigId = resolveRuntimeEdgeConfigId();
  if (params.existingId && params.existingId.trim() && params.existingId.trim() !== defaultEdgeConfigId) {
    logSaveWarn("save.edge_config.tenant_binding_overridden", {
      tenantSlug: params.tenantSlug,
      existingId: params.existingId,
      defaultEdgeConfigId,
    });
  }
  return defaultEdgeConfigId;
}

