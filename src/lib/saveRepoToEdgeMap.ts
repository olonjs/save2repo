type RepoJsonFile = {
  path: string;
  content: unknown;
};

export type RepoToEdgeEntry = {
  type: "config" | "page";
  slug: string;
  data: unknown;
  sourcePath: string;
};

export type RepoToEdgeMapResult = {
  entries: RepoToEdgeEntry[];
  warnings: string[];
  stats: {
    inputFiles: number;
    mappedPages: number;
    mappedConfig: number;
  };
};

function sanitizeSlug(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-z0-9_-]/g, "-"))
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/") || "home";
}

function looksLikePagePayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { sections?: unknown }).sections);
}

export function mapRepoJsonFilesToEdgeEntries(files: RepoJsonFile[]): RepoToEdgeMapResult {
  const entries: RepoToEdgeEntry[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/");
    if (normalizedPath === "src/data/config/site.json") {
      entries.push({
        type: "config",
        slug: "site",
        data: file.content,
        sourcePath: normalizedPath,
      });
      continue;
    }

    const pageMatch = normalizedPath.match(/^src\/data\/pages\/(.+)\.json$/i);
    if (!pageMatch) continue;
    const slug = sanitizeSlug(pageMatch[1] ?? "home");
    if (!looksLikePagePayload(file.content)) {
      warnings.push(`Skipping invalid page payload at ${normalizedPath} (missing sections array).`);
      continue;
    }
    entries.push({
      type: "page",
      slug,
      data: file.content,
      sourcePath: normalizedPath,
    });
  }

  const mappedPages = entries.filter((entry) => entry.type === "page").length;
  const mappedConfig = entries.filter((entry) => entry.type === "config").length;

  return {
    entries,
    warnings,
    stats: {
      inputFiles: files.length,
      mappedPages,
      mappedConfig,
    },
  };
}
