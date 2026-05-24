import { NextResponse } from "next/server";

// ----------------------------------------------------------------------------
// GET /api/v1/templates
//
// Proxy to the olonjs backend's bearer-authenticated templates endpoint
// (jsonpages-platform: /api/v1/save2repo/templates). save2repo deployments
// do NOT carry the GitHub App private key (ADR-006), so they cannot list the
// olonjs/* template gallery directly — the request is forwarded server-side
// with the SAVE2REPO_DEPLOYMENT_TOKEN bearer.
//
// Response shape matches the previous (parent-style) endpoint so the
// CreateTenantModal does not change:
//   200 { templates: OlonjsTemplate[] }
//   503 { error, message } — olonjs backend unreachable / 5xx
// ----------------------------------------------------------------------------

export const dynamic = "force-dynamic";
// Tenant-side cache for 5 min so we do not hammer olonjs on every wizard open.
export const revalidate = 300;

type OlonjsTemplate = {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  homepage: string;
  previewUrl: string;
};

function resolveOlonjsApiBase(): string {
  return process.env.OLONJS_API_BASE?.trim() || "https://app.olon.it/api/v1";
}

export async function GET() {
  const token = process.env.SAVE2REPO_DEPLOYMENT_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error: "deployment_token_missing",
        message:
          "SAVE2REPO_DEPLOYMENT_TOKEN env var is not set on this save2repo deployment; the olonjs backend cannot be reached.",
      },
      { status: 503 },
    );
  }

  const url = `${resolveOlonjsApiBase().replace(/\/+$/, "")}/save2repo/templates`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Use Next's fetch cache so a single olonjs miss is shared across requests.
      next: { revalidate: 300, tags: ["save2repo-templates"] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return NextResponse.json(
      { error: "olonjs_unreachable", message: `${url}: ${message}` },
      { status: 503 },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: "olonjs_upstream",
        message: `olonjs returned ${res.status}: ${body.slice(0, 300)}`,
      },
      { status: res.status === 401 || res.status === 403 ? res.status : 503 },
    );
  }

  const data = (await res.json()) as { templates?: OlonjsTemplate[] };
  return NextResponse.json({ templates: data.templates ?? [] });
}
