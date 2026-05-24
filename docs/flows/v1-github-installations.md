# `GET /api/v1/github/installations`

## Purpose

Expose GitHub App installation inventory and install/configure URLs for UI selection and diagnostics.

## Trigger / Caller

- Primary caller: `src/app/dashboard/page.tsx`

## Request Contract

- Method: `GET`
- Auth: none at route level
- Query/body: none
- Runtime behavior:
  - if GitHub App env missing, returns `installationsError` instead of hard failure

## State Machine Effects

- Read-only; no DB mutation

## External Dependencies

- GitHub App JWT auth (`GET /app/installations`)
- Environment:
  - `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`
  - optional install/configure URL envs

## Response Contract

- `200`:
  - `installUrl`, `configureUrl`
  - `installations[]` (id/account/repository_selection/created_at)
  - optional `installationsError`
- `500` only on outer unexpected exception

## Observability

- Errors logged with `Error fetching installations`
- API error path logs `GitHub Installations API Error`

## Failure Modes & Recovery

- Missing app config -> UI receives `installationsError` and can show setup guidance
- GitHub auth failure (401/404) -> error text indicates likely key/app mismatch

## Verification Gates

- Missing GitHub env still returns `200` with `installationsError`
- Valid app credentials return non-empty installations list where available
- `installUrl` and `configureUrl` are always present in response

