# POST /api/v1/save2repo

## Purpose

Cold sync the full hot truth from Edge Config into GitHub repository, trigger Vercel deployment, and reset dirty-state on success.

## Trigger / Caller

- Explicit “Sync to Repo” action in Studio/governance flow.
- Feature-gated rollout path.

## Request Contract

- Headers:
  - `Authorization: Bearer <tenant_api_key>`
  - optional `x-correlation-id`
- Body:
  - optional `message: string` (commit message override)

## SSE Contract

- `step` (`gather`, `commit`, `build`, `live`)
- `log` incremental trace per step
- `error` terminal failure payload
- `done` terminal success payload `{ deployUrl, commitSha, syncedAt }`

## State Machine Effects

1. Read full Edge state.
2. Map Edge keys -> JSP files:
   - `page:*` -> `src/data/pages/*.json`
   - `config:site` -> `src/data/config/site.json`
3. Multi-file commit to GitHub (no `[skip ci]`).
4. Trigger deploy and wait for terminal state.
5. On success:
   - `tenants.vercel_url` update
   - `unsynced_changes_count = 0`
   - `sync_status = "synced"`
   - `last_cold_sync_at = now`

## External Dependencies

- Vercel Edge Config
- GitHub App (installation token)
- Vercel Deployments API
- Supabase (`tenants`, `deployments`)

## Error Semantics

- Dirty-state reset happens only after full success.
- If commit/deploy fails, dirty-state remains unchanged.
- `error` event emitted before stream close.

## Observability

- `save2repo_success` / `save2repo_error` metrics.
- Structured logs including `tenantId`, `correlationId`, `commitSha`.

## Verification Gates

- Happy path:
  - `done` emitted with `deployUrl`.
  - tenant dirty-state reset.
- Failure path:
  - `error` emitted.
  - tenant dirty-state preserved.

