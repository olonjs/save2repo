# POST /api/v1/tenants/:id/cold-save

## Purpose

**Cold save**: persist the Supabase `tenant_content_store` payload to the tenant GitHub repository as JSON files (`src/data/config/site.json`, `src/data/pages/*.json`), then trigger a production Vercel deployment. Inverse direction of HotSave Snapshot (`save2edge-snapshot`).

## Trigger / Caller

- Dashboard project overview: **Cold save** button next to **HotSave Snapshot** (`/dashboard/[id]`).

## Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(owner)`
- Feature flags: `SAVE2ROUTES_BETA`, `SAVE_REPO_ENABLED`
- Body (optional): `{ message?: string }` (Git commit message override)

## State Machine Effects

1. Read `tenant_content_store` (`readTenantContent`).
2. Map to repo files (`tenantContentPayloadToRepoFiles`).
3. `executeCommitBuildDeploy`: Git commits, Vercel deploy wait, update `tenants` (`vercel_url`, `sync_status`, `unsynced_changes_count`, `last_cold_sync_at`), `deployments` upsert, best-effort `refreshTenantPreview`.

## External Dependencies

- Supabase `tenants`, `tenant_content_store`, `deployments`
- GitHub App (installation)
- Vercel API

## Response Contract

- SSE: `step` / `log` / `error` / `done`
- `done`: `correlationId`, `tenantId`, `deployUrl`, `commitSha`, `syncedAt`, `filesWritten`

## Error codes

- `ERR_COLD_SAVE_DISABLED`, `ERR_UNAUTHORIZED`, `ERR_TENANT_NOT_FOUND`
- `ERR_GITHUB_INSTALLATION_MISSING`, `ERR_VERCEL_PROJECT_MISSING`
- `ERR_STORE_EMPTY` (no row or empty mapped files)
- Pipeline: `ERR_VERCEL_*`, `ERR_GITHUB_*`, `ERR_TENANT_SYNC_STATE_PERSIST_FAILED`, `ERR_REPO_DEPLOY_PIPELINE_INTERNAL`

## Limits

- Same content shape as the content store: `siteConfig` + `pages` only (no `menu.json` / `theme.json` unless added to the store model later).
