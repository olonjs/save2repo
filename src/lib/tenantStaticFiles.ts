import { put } from "@vercel/blob";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildLlmsTxt,
  buildSiteManifest,
  buildPageManifest,
  buildPageManifestHref,
  buildPageContract,
  buildPageContractHref,
} from "@/lib/webmcpBuilders";

// --- Types ---

interface PageConfig {
  id: string;
  slug: string;
  meta: { title: string; description: string };
  sections: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  "global-header"?: boolean;
}

interface SiteConfig {
  identity: { title: string; logoUrl?: string };
  header?: { id: string; type: string; data: Record<string, unknown> };
  footer: { id: string; type: string; data: Record<string, unknown> };
}

export interface TenantStaticFilesInput {
  tenantSlug: string;
  pages: Record<string, unknown>;
  siteConfig: unknown;
}

interface StaticFile {
  blobPath: string;
  content: string;
  contentType: string;
}

// --- Base URL resolution ---

export async function resolveTenantBaseUrl(tenantId: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: domain } = await supabase
    .from("tenant_domains")
    .select("domain")
    .eq("tenant_id", tenantId)
    .in("status", ["active", "verified"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (domain?.domain) return `https://${domain.domain}`;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("vercel_public_url, vercel_url")
    .eq("id", tenantId)
    .single();

  return tenant?.vercel_public_url || tenant?.vercel_url || "";
}

// --- File generation ---

function buildRobotsTxt(baseUrl: string): string {
  return `User-agent: *
Allow: /
Disallow: /api/

User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-Web
User-agent: PerplexityBot
User-agent: OAI-SearchBot
Allow: /
Allow: /*.json
Allow: /schemas/
Allow: /llms.txt
Allow: /mcp-manifest.json
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlUrl(loc: string, opts?: { lastmod?: string; changefreq?: string; priority?: string }): string {
  const lines = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (opts?.lastmod) lines.push(`    <lastmod>${opts.lastmod}</lastmod>`);
  if (opts?.changefreq) lines.push(`    <changefreq>${opts.changefreq}</changefreq>`);
  if (opts?.priority) lines.push(`    <priority>${opts.priority}</priority>`);
  lines.push(`  </url>`);
  return lines.join("\n");
}

function buildSitemapXml(baseUrl: string, pages: Record<string, PageConfig>): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const entries: string[] = [];

  entries.push(xmlUrl(`${baseUrl}/llms.txt`, { changefreq: "weekly", priority: "1.0" }));
  entries.push(xmlUrl(`${baseUrl}/mcp-manifest.json`, { changefreq: "weekly", priority: "1.0" }));

  for (const slug of Object.keys(pages).sort()) {
    const humanPath = slug === "home" ? "/" : `/${slug}`;
    entries.push(xmlUrl(`${baseUrl}${humanPath}`, { lastmod: now, changefreq: "daily", priority: "0.9" }));
    entries.push(xmlUrl(`${baseUrl}/${slug}.json`, { lastmod: now, changefreq: "daily", priority: "0.9" }));
    entries.push(xmlUrl(`${baseUrl}/schemas/${slug}.schema.json`, { changefreq: "weekly", priority: "0.8" }));
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ``,
    entries.join("\n"),
    ``,
    `</urlset>`,
  ].join("\n");
}

function buildAgentCard(tenantSlug: string, siteConfig: SiteConfig, pages: Record<string, PageConfig>): string {
  const cloudUrl = process.env.JSONPAGES_CLOUD_URL || "https://app.olon.it/api/v1";
  const homePage = pages["home"];
  const siteName = siteConfig.identity?.title || tenantSlug;
  const siteDescription = homePage?.meta?.description || "";

  const card = {
    name: siteName,
    description: siteDescription,
    url: `${cloudUrl}/a2a/t/${tenantSlug}`,
    version: "1.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "read-content",
        name: "Read a tenant page's current content",
        description: "Fetch the current content of a page by slug, including sections and form submission schemas.",
      },
      {
        id: "submit-form",
        name: "Submit a form on the tenant site",
        description: "Submit a contact, booking, or inquiry form on behalf of a visitor.",
      },
    ],
  };

  return JSON.stringify(card, null, 2) + "\n";
}

export function generateTenantStaticFiles(input: TenantStaticFilesInput & { baseUrl: string }): StaticFile[] {
  const { tenantSlug, baseUrl } = input;
  const pages = (input.pages ?? {}) as Record<string, PageConfig>;
  const siteConfig = (input.siteConfig ?? {}) as SiteConfig;
  const base = `tenants/${tenantSlug}`;
  const files: StaticFile[] = [];

  files.push({ blobPath: `${base}/robots.txt`, content: buildRobotsTxt(baseUrl), contentType: "text/plain" });
  files.push({ blobPath: `${base}/sitemap.xml`, content: buildSitemapXml(baseUrl, pages), contentType: "application/xml" });
  files.push({ blobPath: `${base}/llms.txt`, content: buildLlmsTxt({ pages, siteConfig }) + "\n", contentType: "text/plain" });
  files.push({ blobPath: `${base}/.well-known/agent-card.json`, content: buildAgentCard(tenantSlug, siteConfig, pages), contentType: "application/json" });
  files.push({
    blobPath: `${base}/mcp-manifest.json`,
    content: JSON.stringify(buildSiteManifest({ pages, siteConfig }), null, 2) + "\n",
    contentType: "application/json",
  });

  for (const [slug, pageConfig] of Object.entries(pages)) {
    files.push({
      blobPath: `${base}/pages/${slug}.json`,
      content: JSON.stringify(pageConfig, null, 2) + "\n",
      contentType: "application/json",
    });
    const manifest = buildPageManifest({ slug, pageConfig, siteConfig });
    files.push({
      blobPath: `${base}${buildPageManifestHref(slug)}`,
      content: JSON.stringify(manifest, null, 2) + "\n",
      contentType: "application/json",
    });
    const contract = buildPageContract({ slug, pageConfig, siteConfig });
    files.push({
      blobPath: `${base}${buildPageContractHref(slug)}`,
      content: JSON.stringify(contract, null, 2) + "\n",
      contentType: "application/json",
    });
  }

  return files;
}

// --- Blob upload ---

function resolveBlobToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.JSONPAGES_READ_WRITE_TOKEN?.trim() || null;
}

export async function uploadTenantStaticFiles(files: StaticFile[]): Promise<{ uploadedCount: number }> {
  const token = resolveBlobToken();
  if (!token) throw new Error("ERR_BLOB_TOKEN_MISSING: Blob token not configured");

  await Promise.all(
    files.map((file) =>
      put(file.blobPath, file.content, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: file.contentType,
        cacheControlMaxAge: 0,
        token,
      }),
    ),
  );

  return { uploadedCount: files.length };
}
