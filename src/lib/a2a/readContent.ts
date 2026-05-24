import { NextResponse } from "next/server";
import { a2aCorsHeaders, ok } from "@/lib/a2a/jsonRpc";

/**
 * A2A read-content tool — save2repo flavor.
 *
 * TODO(T-111): wire to GitHub Contents API via the tenant's repo and the
 * shared `olonjs` GitHub App installation token (see ADR-006, ADR-010). The
 * parent jsonpages-platform implementation read from the centralized
 * `tenant_content_store` Supabase table; save2repo has removed that store
 * per ADR-005 and reads content directly from the tenant's repo at
 * `<owner>/<repo-slug>` (e.g. `pages/<slug>.jsp.json`).
 *
 * For now this returns an empty content envelope so the MCP gateway can
 * advertise the tool without runtime errors; the agent must fall back to
 * editor-driven save until T-111 lands.
 */
export async function executeA2aReadContent(params: {
  tenant: { id: string; slug: string };
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { tenant, correlationId, id, args } = params;
  const slug =
    typeof args.slug === "string" && args.slug.trim() ? args.slug.trim() : "home";

  return NextResponse.json(
    ok(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tenantSlug: tenant.slug,
              slug,
              page: null,
              siteConfig: null,
              note: "T-111 not yet implemented; read-content returns empty envelope",
              correlationId,
            },
            null,
            2
          ),
        },
      ],
    }),
    { headers: a2aCorsHeaders }
  );
}
