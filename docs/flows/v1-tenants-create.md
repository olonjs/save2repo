# `POST /api/v1/tenants/create`

## Purpose

Legacy synchronous tenant provisioning saga (GitHub repo -> Vercel project -> env vars -> Supabase tenant).

## Trigger / Caller

- Legacy/internal caller path (not current primary Dopa stream flow)
- Kept for compatibility

## Request Contract

- Method: `POST`
- Auth: no explicit route auth; caller must provide body values
- Body:
  - `installationId`, `userId`, `slug`, `ownerLogin`
  - optional `accountType` (`User` or `Organization`)
- Hard validations:
  - missing required fields -> `400 ERR_BAD_REQUEST`
  - invalid slug after sanitization -> `400 ERR_BAD_REQUEST`
  - missing Vercel config -> `500 ERR_VERCEL_CONFIG`

## State Machine Effects

- No direct `billing_intents` transition
- Persists new row in `tenants` with `status=provisioned`
- Injects API key and env vars into Vercel project
- Best-effort post-insert set of `JSONPAGES_TENANT_ID`

## External Dependencies

- GitHub App APIs (template create + fallback copy)
- Vercel APIs (project/env)
- Supabase (`tenants`)
- Environment:
  - GitHub App credentials
  - `VERCEL_TEAM_ID`, `VERCEL_AUTH_TOKEN`

## Response Contract

- `200`:
  - `{ success: true, tenant: {...}, api_key }`
- `409`:
  - `ERR_GITHUB_NAME_TAKEN`
- `402`:
  - `ERR_VERCEL_LIMIT_REACHED`
- `403`:
  - `ERR_GITHUB_TEMPLATE_FORBIDDEN`
- `5xx`:
  - `ERR_GITHUB_FAILED`, `ERR_VERCEL_FAILED`, `ERR_VERCEL_ENV_FAILED`, `ERR_SUPABASE_FAILED`, `ERR_UNKNOWN`

## Observability

- Logs:
  - `[tenants/create] GitHub`
  - `[tenants/create] Vercel`
  - `[tenants/create] Supabase`
- Includes step-level context for GitHub fallback phases

## Failure Modes & Recovery

- GitHub 403 integration permissions -> reconfigure app permissions/install scope
- Vercel quota issue -> user/team plan or cleanup action required
- Partial saga failure -> no automatic rollback; operator cleanup may be needed

## Verification Gates

- Successful call creates GitHub repo, Vercel project, tenant row
- Org installation path uses `createInOrg`
- Duplicate repo name returns deterministic `409 ERR_GITHUB_NAME_TAKEN`
- Env injection failures surface `ERR_VERCEL_ENV_FAILED`

