# POST /api/v1/tenants/previews/bootstrap

## Purpose

Bootstraps tenant preview images for the dashboard. Selects up to `N` tenants per request (`TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE`, default 4, max 8) and refreshes them **sequentially** to reduce serverless memory/CPU spikes.

## Trigger / Caller

- Dashboard initial load (bootstrap previews for listed tenants).
- Per-card manual refresh (typically with `priorityTenantIds` + `force` handled client-side for retry policy).

## Request Contract

- Auth: `requireRequestUser`
- Body:
  - `tenantIds` (string array; tenants eligible for this call)
  - `priorityTenantIds` (optional string array; processed first when present in `tenantIds`)

## State Machine Effects

1. Load tenants by `tenantIds` for the authenticated owner; require non-empty `vercel_url`.
2. **Priority queue:** tenants in `priorityTenantIds` first (including when preview is already `ready`, so manual refresh can run).
3. **Regular queue:** other tenants with missing/stale preview; `pending` rows are skipped until stale per `TENANT_PREVIEW_PENDING_STALE_MS` (default 10 minutes).
4. Slice combined list to batch size cap.
5. For each candidate, await `refreshTenantPreview` in order (sequential, not parallel).

## External Dependencies

- Supabase `tenants` (metadata, `vercel_url`, preview columns)
- `refreshTenantPreview` in `src/lib/tenantPreview.ts` (Playwright screenshot → Blob)

## Response Contract

- `200`: bootstrap summary (`queued`, `completed`, `failed`, per-tenant errors in `failed[]` with `errorCode` / `message`)

## Operational notes

- **Vercel Deployment Protection** on the **tenant** project can cause captures to show the Vercel auth page (401 without session). Mitigate with team/project protection settings or `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` on the platform (see `CONTEXT.md`).
- **`vercel_url`** is the capture target (not custom domain primary); set at provision from Vercel deployment API (`alias[0]` or deployment `url`).

## Observability

- Server logs: `[tenant-preview.bootstrap.*]`, `[tenant-preview.capture.*]`
- Client: `[dashboard.preview.bootstrap.*]` (when instrumented)
