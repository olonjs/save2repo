# HotSave Snapshot Runbook

## Purpose

Allow a tenant owner to repopulate `tenant_content_store` from repository JSON files through the dashboard action `HotSave Snapshot`.

## Trigger

From project page overview (`/dashboard/:id`), click `HotSave Snapshot`.

## Data Sources

- `src/data/config/site.json`
- `src/data/pages/*.json`

Files are read from the tenant GitHub repository using the tenant GitHub App installation.

## Security Model

- Endpoint requires dashboard bearer session token.
- Tenant access is validated with `assertTenantAccess(... requiredRole: "owner")`.
- No tenant API key is exposed in the browser flow.

## SSE Steps

1. `gather_repo`: read repository JSON files
2. `map_content`: map repo files to content payload (`siteConfig`, `pages`)
3. `write_store`: replace tenant payload in Supabase store
4. `finalize`: persist tenant metadata update

## Success Criteria

- Stream emits `done`
- `GET /api/v1/content` for tenant API key returns:
  - `contentStatus=ok`
  - `namespaceMatchedKeys > 0`

## Failure Handling

- `ERR_UNAUTHORIZED`: missing/expired dashboard session
- `ERR_TENANT_ACCESS_DENIED`: caller is not tenant owner
- `ERR_GITHUB_INSTALLATION_MISSING`: tenant not linked to GitHub App
- `ERR_REPO_SNAPSHOT_EMPTY`: no valid JSON content found
- `ERR_HOTSAVE_SNAPSHOT_INTERNAL`: unhandled backend failure

Always inspect `correlationId` from stream error payload.

## Re-run Behavior

Operation is idempotent at practical level: repeated runs replace tenant payload with latest repo JSON.
