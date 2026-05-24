# `GET /api/v1/github/repos`

## Purpose

List repositories accessible by a specific GitHub App installation, with pagination aggregation.

## Trigger / Caller

- Primary caller: `src/app/dashboard/components/CreateTenantFlow.tsx`

## Request Contract

- Method: `GET`
- Auth: none at route level
- Query:
  - `installation_id` (required)
- Hard validation:
  - missing `installation_id` -> `400`

## State Machine Effects

- Read-only; no DB mutation

## External Dependencies

- GitHub App installation auth (`app.getInstallationOctokit`)
- GitHub API `listReposAccessibleToInstallation` with paging (`per_page=100`)

## Response Contract

- `200`:
  - `{ repos: [...] }` aggregated across pages
- `400`:
  - missing parameter
- `500`:
  - GitHub API/runtime error

## Observability

- Error log key: `GitHub API Error`

## Failure Modes & Recovery

- Invalid installation id or revoked installation -> route returns `500`; caller should refresh installation context
- Large repo sets are handled by iterative paging; no silent truncation at 30/100 default page limits

## Verification Gates

- Missing query param returns `400`
- Pagination loop returns all available repos
- Valid installation id returns `200` and repo list shape expected by client

