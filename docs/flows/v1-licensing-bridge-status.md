# `GET /api/v1/licensing/bridge-status`

## Purpose

Resolve whether billing can proceed to checkout (`bridge_ready`) by validating GitHub App installation context for a user and optional tenant.

## Trigger / Caller

- Primary caller: `src/app/dashboard/page.tsx`
- Called after subscribe intent selection, before checkout creation

## Request Contract

- Method: `GET`
- Auth: required (`requireRequestUser`)
- Query:
  - `plan` (required, supported plan code)
  - `installation_id` (optional, integer > 0)
  - `tenant_id` (optional, UUID)
- Header:
  - `x-correlation-id` optional; server resolves/falls back
- Hard validations:
  - invalid `plan` -> `400 ERR_PLAN_INVALID`
  - invalid `tenant_id` -> `400 ERR_TENANT_ID_INVALID`
  - invalid `installation_id` -> `400 ERR_INSTALLATION_ID_INVALID`

## State Machine Effects

- Computes and returns:
  - `bridge_ready` when installation is resolvable
  - `bridge_missing` when installation cannot be resolved
- If `tenant_id` is present, upserts `billing_intents` on `tenant_id,plan_code` with:
  - `state`
  - resolved installation metadata
  - `correlation_id`
- No-regression rule:
  - stale explicit installation id does not hard-fail flow; downgraded to `bridge_missing`

## External Dependencies

- Supabase: `billing_intents`
- GitHub App:
  - `getAppInstallationById`
  - fallback `listAppInstallations` by `githubLogin`

## Response Contract

- `200`:
  - `correlationId`, `state`, `tenantId`, `selectedInstallationId`, `staleInstallationId`, `installUrl`, `configureUrl`
- `500`:
  - `ERR_BILLING_STATE_PERSIST_FAILED`
  - `ERR_GITHUB_APP_CONFIG_MISSING`
  - `ERR_GITHUB_APP_INSTALLATION_FETCH_FAILED`

## Observability

- Info log keyspace: `[licensing.bridge-status]`
- Minimum keys:
  - `correlationId`, `eventKey`, `userId`, `planCode`, `requestedInstallationId`, `staleInstallationId`, `fallback`

## Failure Modes & Recovery

- Missing or invalid install context -> client redirects user to install/configure GitHub App
- Stale installation id -> continue with `bridge_missing`, no hard block
- Persist error -> retry flow with same correlation for traceability

## Verification Gates

- Invalid `plan` / `tenant_id` / `installation_id` each returns expected `400` + code
- Stale `installation_id` returns `200 bridge_missing` and includes `staleInstallationId`
- Valid installation returns `200 bridge_ready`
- Tenant-scoped call persists `billing_intents` row with resolved state

