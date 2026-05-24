# POST /api/v1/tenants/:id/save2edge-snapshot

## Purpose

Creates a full content snapshot from the tenant GitHub repository into the Supabase content store. Used to bootstrap or reconcile the cloud content store from the repository source of truth.

## Trigger / Caller

- Dashboard "Sync from repo" action.
- Initial content migration for existing tenants adopting cloud content.

## Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(owner)`
- Feature flag: `SAVE2ROUTES_BETA`
- Headers: optional `x-correlation-id`
- No body required.

## SSE Events

- `step`: `gather_repo` -> `map_content` -> `write_store` -> `finalize` -> `static_files`
- `log`: incremental messages per step
- `error`: `{ message, code, correlationId, stepId? }`
- `done`: `{ correlationId, tenantId, namespace, entitiesWritten, pagesWritten, configWritten, completedAt }`

## State Machine Effects

1. Verify feature flag `SAVE2ROUTES_BETA`.
2. Authenticate user and verify owner access on tenant.
3. Load tenant record and validate `github_installation_id`.
4. **gather_repo**: Read JSON files from GitHub repository:
   - `src/data/config/site.json` (site config)
   - `src/data/pages/*.json` (all page files)
5. **map_content**: Map repository files to content entries via `mapRepoJsonFilesToEdgeEntries`. Log warnings for unmapped files.
6. **write_store**: Build content payload and write full snapshot via `replaceTenantContent`.
7. **finalize**: Update tenant `updated_at` metadata.
8. **static_files** *(non-fatal)*: Generate discovery files in memory from the written content and upload to Vercel Blob at stable paths under `tenants/{slug}/`. See ADR-003.
   - Files: `robots.txt`, `sitemap.xml`, `llms.txt`, `mcp-manifest.json`, `pages/{slug}.json` (one per page), `mcp-manifests/{slug}.json` (one per page).
   - Failure logs a warning and emits a `log` SSE event but does not roll back the snapshot.

## External Dependencies

- GitHub API via Octokit (read repository files, requires `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`)
- Supabase `tenant_content` (via `tenantContentStore.replaceTenantContent`)
- Supabase `tenants` (metadata)

## Response Contract (SSE)

- Success: `done` event with entity counts
- Error events with codes:
  - `ERR_SAVE2EDGE_DISABLED` — feature flag off
  - `ERR_UNAUTHORIZED` — auth failure
  - `ERR_TENANT_NOT_FOUND` — tenant not found
  - `ERR_GITHUB_INSTALLATION_MISSING` — no GitHub App installation
  - `ERR_REPO_SNAPSHOT_EMPTY` — no valid page/config files found
  - `ERR_TENANT_UPDATE_FAILED` — metadata update failed
  - `ERR_HOTSAVE_SNAPSHOT_INTERNAL` — unhandled error

## Observability

- `hotsave_snapshot_success` / `hotsave_snapshot_error` metrics.
- Structured logs: `hotsave_snapshot.completed`, `hotsave_snapshot.failed`.

## Failure Modes & Recovery

- GitHub read fails: SSE error event, no partial writes.
- Empty repository (no JSON files): returns error before write step.
- Content store write fails: error event, tenant state not updated.
- Metadata update fails: content is written but `updated_at` is stale. Safe to retry.

## Verification Gates

- Run snapshot and verify:
  - `entitiesWritten` matches repository file count.
  - `GET /api/v1/content` returns the snapshotted content.
  - `pagesWritten` and `configWritten` counts are correct.
