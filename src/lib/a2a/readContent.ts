import { NextResponse } from "next/server";
import { a2aCorsHeaders, err, ok } from "@/lib/a2a/jsonRpc";
import { readContent, ContentNotFoundError, ContentApiError } from "@/lib/githubContent";
import { GithubInstallationTokenError } from "@/lib/githubAppClient";
import { resolveTenantRepoContext } from "@/lib/tenantRepoContext";

/**
 * A2A read-content tool — save2repo flavor (T-111).
 *
 * Reads tenant content directly from the buyer's GitHub repo via
 * githubContent.readContent (same backend the MCP gateway uses for the
 * read-content tool, T-110 slice 2). ADR-005: no central content store.
 *
 * Path resolution: the caller passes `slug` (defaults to "home"). The slug
 * maps to a JSON file under `pages/<slug>.jsp.json`. Templates that store
 * content at a different convention can override by passing `path` directly
 * (escape hatch for non-jsp templates).
 */
export async function executeA2aReadContent(params: {
  tenant: { id: string; slug: string };
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { tenant, correlationId, id, args } = params;
  const slug = typeof args.slug === "string" && args.slug.trim() ? args.slug.trim() : "home";
  const explicitPath = typeof args.path === "string" && args.path.trim() ? args.path.trim() : null;
  const filePath = explicitPath ?? `pages/${slug}.jsp.json`;

  const repoCtx = await resolveTenantRepoContext(tenant.id);
  if (!repoCtx.ok) {
    return NextResponse.json(
      err(id, -32000, repoCtx.error, { code: repoCtx.code, correlationId }),
      { status: 409, headers: a2aCorsHeaders },
    );
  }

  try {
    const result = await readContent(repoCtx.installationId, repoCtx.owner, repoCtx.repo, filePath);
    return NextResponse.json(
      ok(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tenantSlug: tenant.slug,
                slug,
                path: filePath,
                content: result.content,
                sha: result.sha,
                correlationId,
              },
              null,
              2,
            ),
          },
        ],
      }),
      { headers: a2aCorsHeaders },
    );
  } catch (error) {
    if (error instanceof ContentNotFoundError) {
      return NextResponse.json(
        err(id, -32004, `Page not found: ${filePath}`, { code: "ERR_CONTENT_NOT_FOUND", correlationId }),
        { status: 404, headers: a2aCorsHeaders },
      );
    }
    if (error instanceof GithubInstallationTokenError) {
      return NextResponse.json(
        err(id, -32000, error.message, { code: error.code, correlationId }),
        { status: error.status, headers: a2aCorsHeaders },
      );
    }
    if (error instanceof ContentApiError) {
      return NextResponse.json(
        err(id, -32000, error.message, { code: error.code, correlationId }),
        { status: error.status, headers: a2aCorsHeaders },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown read-content error";
    return NextResponse.json(
      err(id, -32000, message, { code: "ERR_CONTENT_READ_FAILED", correlationId }),
      { status: 500, headers: a2aCorsHeaders },
    );
  }
}
