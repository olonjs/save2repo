import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { resolveCorrelationId } from "@/lib/licensing";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-Id",
};

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const MAX_UPLOAD_BYTES = Number(process.env.ASSETS_MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
const MAX_UPLOADS_PER_MINUTE = Number(process.env.ASSETS_UPLOAD_RATE_LIMIT_PER_MINUTE ?? 30);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_STALE_TTL_MS = 10 * RATE_LIMIT_WINDOW_MS;
type TenantRateWindow = { timestamps: number[]; lastSeenAt: number };
const tenantUploadWindow = new Map<string, TenantRateWindow>();

type TenantRecord = {
  id: string;
  slug: string;
  api_key: string;
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

function inferExtension(filename: string, mimeType: string): string {
  const byName = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (byName) {
    const normalized = byName === "jpeg" ? "jpg" : byName;
    return normalized;
  }
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "image/avif") return "avif";
  return "bin";
}

function safeBaseName(filename: string): string {
  const base = filename
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 120);
  return base || "asset";
}

function inferMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    bytes[11] === 0x66
  ) {
    return "image/avif";
  }
  return null;
}

function enforceTenantRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const prev = tenantUploadWindow.get(tenantId)?.timestamps ?? [];
  const fresh = prev.filter((ts) => ts >= cutoff);

  // Best-effort cleanup to avoid unbounded memory growth in long-lived instances.
  if (tenantUploadWindow.size > 500) {
    for (const [key, value] of tenantUploadWindow.entries()) {
      if (now - value.lastSeenAt > RATE_LIMIT_STALE_TTL_MS) {
        tenantUploadWindow.delete(key);
      }
    }
  }

  if (fresh.length >= MAX_UPLOADS_PER_MINUTE) {
    tenantUploadWindow.set(tenantId, { timestamps: fresh, lastSeenAt: now });
    return false;
  }
  fresh.push(now);
  tenantUploadWindow.set(tenantId, { timestamps: fresh, lastSeenAt: now });
  return true;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported content-type. Use multipart/form-data",
        code: "ERR_UNSUPPORTED_CONTENT_TYPE",
        correlationId,
      },
      { status: 415, headers: corsHeaders }
    );
  }
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

  if (!enforceTenantRateLimit(tenant.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many uploads, retry in a minute",
        code: "ERR_ASSET_RATE_LIMITED",
        correlationId,
      },
      { status: 429, headers: corsHeaders }
    );
  }

  try {
    const formData = await req.formData();
    const filePart = formData.get("file");
    const requestedFilename = formData.get("filename");

    if (!(filePart instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing file in multipart payload", code: "ERR_FILE_MISSING", correlationId },
        { status: 400, headers: corsHeaders }
      );
    }

    if (filePart.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "Empty file", code: "ERR_FILE_EMPTY", correlationId },
        { status: 400, headers: corsHeaders }
      );
    }

    if (filePart.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too large. Max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
          code: "ERR_FILE_TOO_LARGE",
          correlationId,
        },
        { status: 413, headers: corsHeaders }
      );
    }

    const sniffBytes = new Uint8Array(await filePart.slice(0, 32).arrayBuffer());
    const detectedMime = inferMimeFromBytes(sniffBytes);
    const mimeType = filePart.type || detectedMime || "application/octet-stream";
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type: ${mimeType}`, code: "ERR_FILE_TYPE_NOT_ALLOWED", correlationId },
        { status: 400, headers: corsHeaders }
      );
    }
    if (!detectedMime || detectedMime !== mimeType) {
      return NextResponse.json(
        {
          ok: false,
          error: "File signature does not match declared image type",
          code: "ERR_FILE_SIGNATURE_INVALID",
          correlationId,
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const sourceFilename =
      (typeof requestedFilename === "string" && requestedFilename.trim()) || filePart.name || "asset";
    const extension = inferExtension(sourceFilename, mimeType);
    const basename = safeBaseName(sourceFilename);
    const objectPath = `tenant-assets/${tenant.id}/${Date.now()}-${randomUUID()}-${basename}.${extension}`;

    const blob = await put(objectPath, filePart, {
      access: "public",
      addRandomSuffix: false,
      contentType: mimeType,
      token: blobToken,
    });

    console.info("[assets.upload.completed]", {
      correlationId,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      sizeBytes: filePart.size,
      contentType: mimeType,
      pathname: blob.pathname,
    });

    return NextResponse.json(
      {
        ok: true,
        correlationId,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        url: blob.url,
        pathname: blob.pathname,
        contentType: mimeType,
        size: filePart.size,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("[assets.upload.failed]", {
      correlationId,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message, code: "ERR_ASSET_UPLOAD_FAILED", correlationId },
      { status: 502, headers: corsHeaders }
    );
  }
}
