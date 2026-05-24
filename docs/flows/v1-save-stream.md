# `POST /api/v1/save-stream`

## Purpose

Perform GitHub save + explicit Vercel deploy with SSE progress and deterministic terminal outcome for live publish.

## Trigger / Caller

- Editor/runtime clients requiring realtime publish progress
- Successor endpoint to legacy `/save`

## Request Contract

- Method: `POST`
- Auth: `Authorization: Bearer <tenant_api_key>`
- Body:
  - `path` (required)
  - `content` (required, can be any JSON value)
  - `message` (optional)
- CORS:
  - `OPTIONS` supported
- Prerequisites validated:
  - tenant exists for API key
  - tenant has `github_installation_id` and `vercel_project_id`
  - env includes `VERCEL_TEAM_ID`, `VERCEL_AUTH_TOKEN`

## State Machine Effects

- SSE step sequence:
  - `commit` -> `push` -> `build` -> `live`
- Writes GitHub commit
- Triggers explicit Vercel deployment and polls by deployment id until terminal state
- On `READY`, persists canonical public URL into `tenants.vercel_url`

## External Dependencies

- Supabase: tenant lookup and URL persist
- GitHub App file APIs
- Vercel project/deployment APIs (`v9`, `v13`)

## Response Contract

- Content type: `text/event-stream`
- Events:
  - `step`, `log`, `error`, `done`
- `done` payload:
  - `deployUrl`, `commitSha`
- Error taxonomy includes:
  - `ERR_UNAUTHORIZED`, `ERR_BAD_REQUEST`, `ERR_INVALID_API_KEY`
  - `ERR_GITHUB_INSTALLATION_MISSING`, `ERR_GITHUB_COMMIT_SHA_MISSING`
  - `ERR_VERCEL_PROJECT_MISSING`, `ERR_VERCEL_NOT_CONFIGURED`
  - `ERR_VERCEL_PROJECT_FETCH_FAILED`, `ERR_VERCEL_REPO_LINK_MISSING`
  - `ERR_VERCEL_DEPLOY_TRIGGER_FAILED`, `ERR_VERCEL_DEPLOY_TIMEOUT`, `ERR_VERCEL_DEPLOY_FAILED`
  - `ERR_VERCEL_DEPLOY_URL_MISSING`, `ERR_TENANT_URL_PERSIST_FAILED`
  - `ERR_SAVE_STREAM_INTERNAL`

## Observability

- Logs keyspace: `[save-stream]`
- SSE logs include deployment state trace (`readyState/state => effective`)
- Useful operational keys:
  - `stepId`, `commitSha`, deployment state transitions

## Failure Modes & Recovery

- Deployment timeout/failure -> error event with explicit code; client can retry save/deploy
- Missing repo link on Vercel project -> operator must relink Git repository
- URL persist failure -> deployment may be live but tenant metadata not updated

## Verification Gates

- End-to-end success emits ordered steps and final `done`
- Deployment polling stops correctly on `READY/ERROR/CANCELED/FAILED`
- Canonical URL resolution prioritizes alias, then project domain, then deployment URL
- Any failure path emits structured `error` event code

