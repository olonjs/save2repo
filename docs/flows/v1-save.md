# `POST /api/v1/save`

## Purpose

Legacy synchronous save endpoint: commit JSON content to tenant GitHub repository without deployment orchestration.

## Trigger / Caller

- External/editor clients using tenant API key
- Legacy path; `save-stream` is preferred for deterministic publish workflow

## Request Contract

- Method: `POST`
- Auth: `Authorization: Bearer <tenant_api_key>`
- Body:
  - `path` (required)
  - `content` (required)
  - `message` (optional commit message)
- CORS:
  - `OPTIONS` supported
  - permissive `Access-Control-Allow-Origin: *`

## State Machine Effects

- No billing transitions
- No Vercel deploy trigger
- GitHub repository content is updated/created at `path`

## External Dependencies

- Supabase: tenant lookup by `api_key`
- GitHub App installation token and file APIs

## Response Contract

- `200`:
  - `{ success: true, message: 'Saved to GitHub' }`
- `401`:
  - missing/invalid bearer header
- `403`:
  - invalid API key
- `400`:
  - missing path/content or missing GitHub installation on tenant
- `500`:
  - runtime/GitHub error

## Observability

- Error log keyspace:
  - `Save Error`
  - `API Error`

## Failure Modes & Recovery

- Missing tenant GitHub installation -> caller must fix tenant integration state
- GitHub write failure -> retry after checking repo permissions/rate limits
- Since deploy is not triggered, production URL may remain stale until separate deployment event

## Verification Gates

- Valid API key + payload performs create/update commit
- Invalid API key returns `403`
- Missing bearer header returns `401`
- Route includes CORS headers in success and error responses

