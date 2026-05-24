// Copied from @olonjs/core/src/contract/webmcp-contracts.ts — keep in sync manually.
// Types from kernel.ts are inlined. zodToJsonSchema removed: platform always passes schemas: {}
// so sectionSchemas is always {}, making the Zod introspection dead code.

const WEBMCP_TOOL_REQUEST_TYPE = "olonjs:webmcp:tool-call";
const WEBMCP_TOOL_RESULT_TYPE = "olonjs:webmcp:tool-result";

// --- Inlined types from @olonjs/core/src/contract/kernel.ts ---

interface FallbackSection {
  id: string;
  type: string;
  data: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

type Section = FallbackSection;

interface PageMeta {
  title: string;
  description: string;
}

interface PageConfig {
  id: string;
  slug: string;
  meta: PageMeta;
  sections: Section[];
  "global-header"?: boolean;
}

interface SiteIdentity {
  title: string;
  logoUrl?: string;
}

interface SiteConfig {
  identity: SiteIdentity;
  header?: Section;
  footer: Section;
}

// --- Public types ---

export interface WebMcpToolContract {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface WebMcpSectionInstance {
  id: string;
  type: string;
  scope: "global" | "local";
  label: string;
}

export interface OlonJsPageContract {
  version: "1.0.0";
  kind: "olonjs-page-contract";
  slug: string;
  title: string;
  description: string;
  manifestHref: string;
  systemPrompt: string;
  sectionTypes: string[];
  sectionInstances: WebMcpSectionInstance[];
  sectionSchemas: Record<string, Record<string, unknown>>;
  sectionSubmissionSchemas?: Record<string, Record<string, unknown>>;
  tools: WebMcpToolContract[];
}

export interface OlonJsPageManifest {
  version: "1.0.0";
  kind: "olonjs-page-mcp-manifest";
  generatedAt: string;
  slug: string;
  title: string;
  description: string;
  contractHref: string;
  transport: {
    kind: "window-message";
    requestType: string;
    resultType: string;
    target: "window";
  };
  capabilities: {
    resources: Array<{
      uri: string;
      name: string;
      mimeType: string;
      description: string;
    }>;
  };
  sectionTypes: string[];
  sectionInstances: WebMcpSectionInstance[];
  tools: Array<Pick<WebMcpToolContract, "name" | "description">>;
}

export interface OlonJsSiteManifestIndex {
  version: "1.0.0";
  kind: "olonjs-mcp-manifest-index";
  generatedAt: string;
  pages: Array<{
    slug: string;
    title: string;
    description: string;
    manifestHref: string;
    contractHref: string;
    sectionTypes: string[];
  }>;
}

export interface BuildPageContractInput {
  slug: string;
  pageConfig: PageConfig;
  siteConfig: SiteConfig;
}

export interface BuildSiteManifestInput {
  pages: Record<string, PageConfig>;
  siteConfig: SiteConfig;
}

// --- Helpers ---

function inferSectionLabel(section: { type?: string; data?: unknown }): string {
  const data = section.data && typeof section.data === "object" ? (section.data as Record<string, unknown>) : {};
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  if (typeof data.sectionTitle === "string" && data.sectionTitle.trim()) return data.sectionTitle.trim();
  if (typeof data.label === "string" && data.label.trim()) return data.label.trim();
  return section.type ?? "section";
}

function getPageSections(pageConfig: PageConfig, siteConfig: SiteConfig) {
  const pageSections = Array.isArray(pageConfig?.sections) ? pageConfig.sections : [];
  const globalSections: Array<Section & { scope: "global" }> = [];
  if (siteConfig.header && pageConfig["global-header"] !== false) {
    globalSections.push({ ...siteConfig.header, scope: "global" });
  }
  if (siteConfig.footer) {
    globalSections.push({ ...siteConfig.footer, scope: "global" });
  }
  return [...globalSections, ...pageSections.map((s) => ({ ...s, scope: "local" as const }))];
}

// --- Public builders ---

export function buildPageContractHref(slug: string): string {
  return `/schemas/${slug}.schema.json`;
}

export function buildPageManifestHref(slug: string): string {
  return `/mcp-manifests/${slug}.json`;
}

export function buildPageContract({ slug, pageConfig, siteConfig }: BuildPageContractInput): OlonJsPageContract {
  const title = typeof pageConfig.meta?.title === "string" ? pageConfig.meta.title : slug;
  const description = typeof pageConfig.meta?.description === "string" ? pageConfig.meta.description : "";
  const pageSections = getPageSections(pageConfig, siteConfig);
  const sectionTypes = Array.from(new Set(pageSections.map((s) => String(s.type)).filter(Boolean)));
  const sectionInstances: WebMcpSectionInstance[] = pageSections.map((s) => ({
    id: s.id,
    type: String(s.type),
    scope: s.scope === "global" ? "global" : "local",
    label: inferSectionLabel(s),
  }));

  return {
    version: "1.0.0",
    kind: "olonjs-page-contract",
    slug,
    title,
    description,
    manifestHref: buildPageManifestHref(slug),
    systemPrompt: `You are operating the "${title}" page in OlonJS Studio. Use only the declared tools and keep mutations valid against the section schema.`,
    sectionTypes,
    sectionInstances,
    sectionSchemas: {},
    tools: [],
  };
}

export function buildPageManifest(input: BuildPageContractInput): OlonJsPageManifest {
  const contract = buildPageContract(input);
  return {
    version: "1.0.0",
    kind: "olonjs-page-mcp-manifest",
    generatedAt: new Date().toISOString(),
    slug: input.slug,
    title: contract.title,
    description: contract.description,
    contractHref: buildPageContractHref(input.slug),
    transport: {
      kind: "window-message",
      requestType: WEBMCP_TOOL_REQUEST_TYPE,
      resultType: WEBMCP_TOOL_RESULT_TYPE,
      target: "window",
    },
    capabilities: {
      resources: [
        {
          uri: `olon://pages/${input.slug}`,
          name: `${contract.title} Data`,
          mimeType: "application/json",
          description: `Structured content for the ${input.slug} page.`,
        },
        {
          uri: "olon://pages",
          name: "Site Map",
          mimeType: "application/json",
          description: "Structured content for the map of this site",
        },
      ],
    },
    sectionTypes: contract.sectionTypes,
    sectionInstances: contract.sectionInstances,
    tools: [],
  };
}

export function buildSiteManifest({ pages, siteConfig }: BuildSiteManifestInput): OlonJsSiteManifestIndex {
  const pageEntries = Object.entries(pages ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return {
    version: "1.0.0",
    kind: "olonjs-mcp-manifest-index",
    generatedAt: new Date().toISOString(),
    pages: pageEntries.map(([slug, pageConfig]) => {
      const manifest = buildPageManifest({ slug, pageConfig, siteConfig });
      return {
        slug,
        title: manifest.title,
        description: manifest.description,
        manifestHref: buildPageManifestHref(slug),
        contractHref: buildPageContractHref(slug),
        sectionTypes: manifest.sectionTypes,
      };
    }),
  };
}

export function buildLlmsTxt({ pages, siteConfig }: BuildSiteManifestInput): string {
  const siteTitle = siteConfig.identity?.title || "OlonJS Site";
  const manifestIndex = buildSiteManifest({ pages, siteConfig });

  let markdown = `# ${siteTitle}\n\n`;

  const homePage = manifestIndex.pages.find((p) => p.slug === "home");
  if (homePage?.description) {
    markdown += `${homePage.description}\n\n`;
  }

  markdown += "> **AI Agents:** This site is built with OlonJS. It exposes a native Model Context Protocol (MCP) manifest for direct structural interaction. \n";
  markdown += "> To read the site map or access structured content, use the URI `olon://pages` or `olon://pages/[slug]`.\n";
  markdown += "> Endpoint: `/mcp-manifest.json`\n\n";
  markdown += "## Pages\n\n";

  for (const page of manifestIndex.pages) {
    const urlPath = page.slug === "home" ? "/" : `/${page.slug}`;
    markdown += `- **[${page.title}](${urlPath})** (\`${page.slug}\`)\n`;
    if (page.description) {
      markdown += `  ${page.description}\n`;
    }
    markdown += `  *Contract:* \`${page.contractHref}\` | *Manifest:* \`${page.manifestHref}\`\n\n`;
  }

  return markdown.trim();
}
