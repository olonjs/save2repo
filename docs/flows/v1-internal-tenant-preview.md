# Internal Tenant Preview

## Purpose

Internal endpoints for managing tenant preview image lifecycle. Used by cron jobs and admin tools to keep dashboard preview images fresh.

## Auth (both routes)

- Header: `x-preview-refresh-token`
- Must match env **`TENANT_PREVIEW_INTERNAL_TOKEN`** (server-side).  
- Older docs may mention `PREVIEW_REFRESH_TOKEN`; the implemented variable is **`TENANT_PREVIEW_INTERNAL_TOKEN`**.

---

## POST /api/internal/tenant-preview/reconcile

### Request Contract

- Method: `POST`
- Auth: `x-preview-refresh-token` as above

### State Machine Effects

- Identifies tenants with stale or missing previews (see `reconcileTenantPreviews` in `src/lib/tenantPreview.ts`).
- Triggers refresh for each qualifying tenant.

### Response Contract

- `200`: reconciliation results
- `401/403`: invalid or missing token

---

## POST /api/internal/tenant-preview/refresh

### Request Contract

- Method: `POST`
- Auth: `x-preview-refresh-token` as above
- Body: tenant ID or URL to refresh (see route handler for exact shape)

### State Machine Effects

- Captures fresh preview screenshot for the specified tenant (`refreshTenantPreview`).
- Updates preview metadata and Blob URL in the database.

### Response Contract

- `200`: refresh result
- `401/403`: invalid or missing token
- `404`: tenant not found

---

## External Dependencies

- Supabase `tenants`
- `src/lib/tenantPreview.ts` — Playwright + Chromium, optional `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` for protected `*.vercel.app` deployments
- Vercel Blob (`BLOB_READ_WRITE_TOKEN` / `JSONPAGES_READ_WRITE_TOKEN`)

## Observability

- Preview refresh errors surfaced as `PreviewRefreshError` with stable `ERR_PREVIEW_*` codes
- Vercel protection issues: screenshot shows Vercel interstitial; verify Deployment Protection and bypass secret alignment between **tenant Vercel project** and **platform** env
