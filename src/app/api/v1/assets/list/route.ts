import { list } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { resolveCorrelationId } from "@/lib/licensing";
import { getSupabaseAdmin } from "@/lib/supabase";
//comment
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;

type TenantRecord = {
  id: string;
  slug: string;
  api_key: string;
};

type BlobListEntry = {
  url: string;
  pathname: string;
  contentType?: string;
  uploadedAt?: string | Date;
};

function parseBearerApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function resolveBlobToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.JSONPAGES_READ_WRITE_TOKEN?.trim() || null;
}

function parseLimit(raw: string | null): number {
  const value = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  const rounded = Math.floor(value);
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, rounded));
}

function toIsoDate(input: string | Date | undefined): string | null {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toAltFromPath(pathname: string): string {
  const last = pathname.split("/").pop() || "asset";
  return last.replace(/\.[^.]+$/, "");
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const apiKey = parseBearerApiKey(req);

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Bearer API key", code: "ERR_UNAUTHORIZED", correlationId },
      { status: 401, headers: corsHeaders }
    );
  }

  const blobToken = resolveBlobToken();
  if (!blobToken) {
    return NextResponse.json(
      { ok: false, error: "Blob token is not configured", code: "ERR_BLOB_TOKEN_MISSING", correlationId },
      { status: 500, headers: corsHeaders }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id,slug,api_key")
    .eq("api_key", apiKey)
    .single<TenantRecord>();

  if (tenantError || !tenant?.id) {
    return NextResponse.json(
      { ok: false, error: "Invalid API key", code: "ERR_INVALID_API_KEY", correlationId },
      { status: 403, headers: corsHeaders }
    );
  }

  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
  const tenantPrefix = `tenant-assets/${tenant.id}/`;

  try {
    const listed = await list({
      prefix: tenantPrefix,
      limit,
      cursor,
      token: blobToken,
    });

    const blobs = (listed.blobs as BlobListEntry[]).filter((blob) => blob.pathname.startsWith(tenantPrefix));
    const items = blobs.map((blob) => ({
      id: blob.pathname,
      url: blob.url,
      alt: toAltFromPath(blob.pathname),
      tags: ["blob", "tenant-library"],
      pathname: blob.pathname,
      contentType: blob.contentType ?? null,
      uploadedAt: toIsoDate(blob.uploadedAt),
    }));

    return NextResponse.json(
      {
        ok: true,
        correlationId,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        items,
        cursor: listed.cursor ?? null,
        hasMore: Boolean(listed.hasMore),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset list failed";
    console.error("[assets.list.failed]", {
      correlationId,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message, code: "ERR_ASSET_LIST_FAILED", correlationId },
      { status: 502, headers: corsHeaders }
    );
  }
}
