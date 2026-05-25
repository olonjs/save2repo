import { getInstallationOctokit } from "@/lib/githubAppClient";

const DEFAULT_NOTIFICATION_TEMPLATE_PATH = process.env.FORMS_EMAIL_TEMPLATE_NOTIFICATION_PATH?.trim() || "email-templates/lead-notification.html";
const DEFAULT_SENDER_TEMPLATE_PATH = process.env.FORMS_EMAIL_TEMPLATE_SENDER_PATH?.trim() || "email-templates/lead-sender-confirmation.html";
const DEFAULT_TEMPLATE_REF = process.env.FORMS_EMAIL_TEMPLATE_REF?.trim() || "";
const TEMPLATE_CACHE_TTL_MS = Number(process.env.FORMS_EMAIL_TEMPLATE_CACHE_TTL_MS ?? 5 * 60 * 1000);
const TEMPLATE_MAX_BYTES = Number(process.env.FORMS_EMAIL_TEMPLATE_MAX_BYTES ?? 256 * 1024);

type TemplateKind = "lead_notification" | "sender_confirmation";

type CachedTemplate = {
  html: string;
  expiresAt: number;
};

type TenantRepoConfig = {
  tenantId: string;
  tenantSlug: string;
  installationId: string | null;
  owner: string | null;
  repo: string | null;
  tenantBaseUrl?: string | null;
};

type TemplateContext = {
  tenantName: string;
  correlationId: string;
  replyTo: string | null;
  leadData: Record<string, unknown>;
};

export type ResolvedTemplateResult = {
  html: string;
  source: "tenant_repo" | "fallback";
  templatePath: string | null;
  cacheHit: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  resolvedBaseUrl: string | null;
  rewrittenUrlCount: number;
};

const templateCache = new Map<string, CachedTemplate>();

function resolveTemplatePath(kind: TemplateKind): string {
  return kind === "lead_notification" ? DEFAULT_NOTIFICATION_TEMPLATE_PATH : DEFAULT_SENDER_TEMPLATE_PATH;
}

function buildCacheKey(params: { installationId: string; owner: string; repo: string; path: string; ref: string }): string {
  return [params.installationId, params.owner, params.repo, params.path, params.ref || "default"].join("::");
}

function decodeGithubContent(content: string, encoding: string | null | undefined): string {
  const normalizedEncoding = (encoding ?? "").trim().toLowerCase();
  if (normalizedEncoding !== "base64") {
    throw Object.assign(new Error(`Unsupported GitHub content encoding: ${encoding ?? "unknown"}`), {
      code: "ERR_TEMPLATE_ENCODING_UNSUPPORTED",
    });
  }
  const cleaned = content.replace(/\s+/g, "");
  const buffer = Buffer.from(cleaned, "base64");
  if (buffer.byteLength > TEMPLATE_MAX_BYTES) {
    throw Object.assign(new Error(`Template exceeds max size (${buffer.byteLength} > ${TEMPLATE_MAX_BYTES})`), {
      code: "ERR_TEMPLATE_TOO_LARGE",
    });
  }
  return buffer.toString("utf8");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function resolveTokenValue(context: Record<string, unknown>, tokenPath: string): string {
  const normalized = tokenPath.trim();
  if (!normalized) return "";

  const segments = normalized.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = context;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return "";
    const next = (current as Record<string, unknown>)[segment];
    current = next;
  }
  return safeString(current);
}

function applyTemplateVariables(html: string, templateContext: TemplateContext): string {
  const context: Record<string, unknown> = {
    tenantName: templateContext.tenantName,
    correlationId: templateContext.correlationId,
    replyTo: templateContext.replyTo ?? "",
    lead: templateContext.leadData,
    leadData: templateContext.leadData,
  };

  return html.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, tokenPath: string) => {
    const value = resolveTokenValue(context, tokenPath);
    return escapeHtml(value);
  });
}

function normalizeTenantBaseUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.toString();
  } catch {
    return null;
  }
}

function shouldSkipUrlRewrite(rawUrl: string): boolean {
  const value = rawUrl.trim();
  if (!value) return true;
  if (value.startsWith("#")) return true;
  if (/^(?:data:|mailto:|tel:|cid:|javascript:)/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  if (value.startsWith("//")) return true;
  return false;
}

function absolutizeSingleUrl(rawUrl: string, baseUrl: string): string {
  if (shouldSkipUrlRewrite(rawUrl)) return rawUrl;
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return rawUrl;
  }
}

function absolutizeHtmlUrls(html: string, baseUrl: string | null): { html: string; rewrittenUrlCount: number; resolvedBaseUrl: string | null } {
  const normalizedBase = normalizeTenantBaseUrl(baseUrl);
  if (!normalizedBase) {
    return { html, rewrittenUrlCount: 0, resolvedBaseUrl: null };
  }

  let rewritten = 0;

  const rewriteAttr = (input: string, attr: "src" | "href" | "action" | "poster") => {
    const regex = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, "gi");
    return input.replace(regex, (_match, prefix: string, value: string, suffix: string) => {
      const next = absolutizeSingleUrl(value, normalizedBase);
      if (next !== value) rewritten += 1;
      return `${prefix}${next}${suffix}`;
    });
  };

  let output = html;
  output = rewriteAttr(output, "src");
  output = rewriteAttr(output, "href");
  output = rewriteAttr(output, "action");
  output = rewriteAttr(output, "poster");

  output = output.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (_match, prefix: string, value: string, suffix: string) => {
    const rewrittenSet = value
      .split(",")
      .map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        const rawUrl = parts[0] ?? "";
        const descriptor = parts.slice(1).join(" ");
        const nextUrl = absolutizeSingleUrl(rawUrl, normalizedBase);
        if (nextUrl !== rawUrl) rewritten += 1;
        return descriptor ? `${nextUrl} ${descriptor}` : nextUrl;
      })
      .join(", ");
    return `${prefix}${rewrittenSet}${suffix}`;
  });

  return {
    html: output,
    rewrittenUrlCount: rewritten,
    resolvedBaseUrl: normalizedBase,
  };
}

async function fetchTemplateHtml(params: {
  installationId: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}): Promise<{ html: string; cacheHit: boolean }> {
  const cacheKey = buildCacheKey(params);
  const now = Date.now();
  const cached = templateCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { html: cached.html, cacheHit: true };
  }

  const octokit = await getInstallationOctokit(Number(params.installationId));
  const response = await octokit.rest.repos.getContent({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    ...(params.ref ? { ref: params.ref } : {}),
  });

  if (Array.isArray(response.data)) {
    throw Object.assign(new Error("Template path resolved to a directory"), {
      code: "ERR_TEMPLATE_IS_DIRECTORY",
    });
  }

  if (response.data.type !== "file" || typeof response.data.content !== "string") {
    throw Object.assign(new Error("Template content not available"), {
      code: "ERR_TEMPLATE_CONTENT_MISSING",
    });
  }

  const html = decodeGithubContent(response.data.content, response.data.encoding);
  templateCache.set(cacheKey, {
    html,
    expiresAt: now + TEMPLATE_CACHE_TTL_MS,
  });

  return { html, cacheHit: false };
}

function finalizeTemplateHtml(params: { html: string; context: TemplateContext; tenantBaseUrl?: string | null }) {
  const withVariables = applyTemplateVariables(params.html, params.context);
  return absolutizeHtmlUrls(withVariables, params.tenantBaseUrl ?? null);
}

export async function resolveTenantEmailTemplate(params: {
  kind: TemplateKind;
  tenantRepo: TenantRepoConfig;
  context: TemplateContext;
  fallbackRender: () => Promise<string>;
}): Promise<ResolvedTemplateResult> {
  const templatePath = resolveTemplatePath(params.kind);

  const { installationId, owner, repo } = params.tenantRepo;
  if (!installationId || !owner || !repo) {
    const fallbackHtml = await params.fallbackRender();
    const normalized = finalizeTemplateHtml({
      html: fallbackHtml,
      context: params.context,
      tenantBaseUrl: params.tenantRepo.tenantBaseUrl,
    });

    return {
      html: normalized.html,
      source: "fallback",
      templatePath,
      cacheHit: false,
      errorCode: "ERR_TEMPLATE_REPO_NOT_CONFIGURED",
      errorMessage: "Tenant GitHub repository is not configured",
      resolvedBaseUrl: normalized.resolvedBaseUrl,
      rewrittenUrlCount: normalized.rewrittenUrlCount,
    };
  }

  try {
    const fetched = await fetchTemplateHtml({
      installationId,
      owner,
      repo,
      path: templatePath,
      ref: DEFAULT_TEMPLATE_REF,
    });

    const normalized = finalizeTemplateHtml({
      html: fetched.html,
      context: params.context,
      tenantBaseUrl: params.tenantRepo.tenantBaseUrl,
    });

    return {
      html: normalized.html,
      source: "tenant_repo",
      templatePath,
      cacheHit: fetched.cacheHit,
      errorCode: null,
      errorMessage: null,
      resolvedBaseUrl: normalized.resolvedBaseUrl,
      rewrittenUrlCount: normalized.rewrittenUrlCount,
    };
  } catch (error: any) {
    const fallbackHtml = await params.fallbackRender();
    const normalized = finalizeTemplateHtml({
      html: fallbackHtml,
      context: params.context,
      tenantBaseUrl: params.tenantRepo.tenantBaseUrl,
    });

    return {
      html: normalized.html,
      source: "fallback",
      templatePath,
      cacheHit: false,
      errorCode: typeof error?.code === "string" ? error.code : "ERR_TEMPLATE_FETCH_FAILED",
      errorMessage: error?.message ?? "Template fetch failed",
      resolvedBaseUrl: normalized.resolvedBaseUrl,
      rewrittenUrlCount: normalized.rewrittenUrlCount,
    };
  }
}

