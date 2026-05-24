# `POST /api/v1/link`

## Purpose

Link an existing repository/project context into platform data model by creating tenant + test license records.

## Trigger / Caller

- External/admin/legacy provisioning tooling

## Request Contract

- Method: `POST`
- Auth: none at route level
- Body required fields:
  - `licenseKey`, `repoOwner`, `repoName`, `slug`, `userId`
- Hard validations:
  - missing fields -> `400`
  - invalid license pattern -> `403`

## State Machine Effects

- Inserts `tenants` row
- Inserts `licenses` row linked by `tenant_id`
- License tier/storage derived from test key format

## External Dependencies

- Supabase: `tenants`, `licenses`

## Response Contract

- `200`:
  - `success`, `message`, `project`
- `409`:
  - duplicate slug (`tenantError.code = 23505`)
- `400` / `403`:
  - contract validation failures
- `500`:
  - unexpected DB/runtime failure

## Observability

- Error logs:
  - `API Error`

## Failure Modes & Recovery

- Slug collision -> caller must choose a different slug
- License rejected -> generate/provide valid key format
- Partial insert risk is limited by route control flow; DB constraints enforce uniqueness

## Verification Gates

- Valid payload creates both tenant and license rows
- Duplicate slug returns `409`
- Invalid license key returns `403`

