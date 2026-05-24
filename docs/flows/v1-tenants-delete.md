# Tenant Delete (Hard Delete)

## Purpose

Provide a controlled hard-delete flow for a tenant/project from dashboard settings, removing storage artifacts and database references in deterministic order.

## Trigger / Caller

- Dashboard project settings tab (`Delete project` action).

## Request Contract

- Endpoint: `DELETE /api/v1/tenants/:id`
- Auth: `requireRequestUser` + `assertTenantAccess(admin)`
- Path params:
  - `id` (tenant id)
- Headers:
  - `Authorization: Bearer <supabase_access_token>` (required)
  - `Idempotency-Key` (required, UUID)
  - `x-correlation-id` (optional, generated if absent)

## State Machine Effects

1. Authorize caller as tenant `owner` or `admin`.
2. Resolve idempotency event (when `Idempotency-Key` is present):
   - `success`: replay previous response (`idempotentReplay: true`)
   - `pending`: return `ERR_TENANT_DELETE_IN_PROGRESS`
   - `error`: replay previous error (`idempotentReplay: true`)
3. Delete Vercel project (strict gate):
   - identifier: `vercel_project_id` (fallback `tenant.slug`)
   - API: `DELETE /v9/projects/{identifier}?teamId=...`
   - non-2xx/non-404 -> terminal error (`ERR_TENANT_VERCEL_DELETE_FAILED`)
4. Delete blob objects under:
   - `tenant-assets/{tenantId}/`
   - `tenant-previews/{tenantId}/`
5. Execute atomic SQL transaction (RPC `delete_tenant_with_entitlement_release`):
   - delete rows in `deployments` where `tenant_id = :id`
   - release tenant-bound entitlements in `billing_intents` (`tenant_id = null`, `state = licensed_ready_unassigned`)
   - delete row in `tenants` where `id = :id`
5. Rely on FK cascade to remove dependent rows (except released entitlements), such as `licenses`, `tenant_domains`, `leads`, `tenant_content_store`, etc.

## External Dependencies

- Supabase (auth + DB):
  - `tenants`
  - `deployments`
  - cascaded dependent tables
- Vercel Blob (`@vercel/blob`):
  - `list` with prefix pagination
  - `del` batch deletion
- Vercel Projects API:
  - strict delete before DB transaction (`VERCEL_TEAM_ID`, `VERCEL_AUTH_TOKEN`)

## Response Contract

- `200`
  - `{ correlationId, tenant: { id, name, slug, deleted: true }, deleted: { deployments, entitlementsReleased, blob } }`
- `400`
  - `ERR_TENANT_DELETE_IDEMPOTENCY_REQUIRED`
- `401`
  - Missing/invalid bearer session
- `403`
  - Tenant access denied / role insufficient
- `404`
  - `ERR_TENANT_NOT_FOUND`
- `409`
  - `ERR_TENANT_DELETE_IN_PROGRESS`
- `500`
  - `ERR_TENANT_DELETE_LOOKUP_FAILED`
  - `ERR_TENANT_BLOB_DELETE_FAILED`
  - `ERR_TENANT_DELETE_TRANSACTION_FAILED`
  - `ERR_TENANT_DELETE_MIGRATION_MISSING`
  - `ERR_TENANT_DELETE_IDEMPOTENCY_LOOKUP_FAILED`
  - `ERR_TENANT_DELETE_IDEMPOTENCY_INIT_FAILED`
- `502`
  - `ERR_TENANT_VERCEL_DELETE_FAILED`

## Observability

- Correlation id propagated in all responses.
- Error codes are explicit for each failing stage (blob cleanup, deployments delete, tenant delete).

## Failure Modes & Recovery

- Vercel delete failure blocks blob+DB deletion to avoid orphan projects in team Vercel.
- Blob cleanup failure blocks DB deletion to avoid partial delete drift.
- Any DB stage failure inside RPC causes full rollback for entitlement+tenant consistency.
- If migration is missing, endpoint returns `ERR_TENANT_DELETE_MIGRATION_MISSING`.
- If transaction fails after blob cleanup, operation is safe to retry after resolving DB cause.
- Idempotency lock avoids duplicate execution for the same `tenant + actor + key`.

## Important Maintenance Note

- The entitlement release state list is explicitly defined in SQL function `delete_tenant_with_entitlement_release`.
- If new "assigned-like" licensing states are introduced, update that function accordingly.

## Verification Gates

1. Unauthorized user receives `401`.
2. Non-authorized tenant user receives `403`.
3. Tenant with assets + previews:
   - prefixes are emptied,
   - `deployments` rows removed first,
   - `tenants` row deleted.
4. API returns deterministic error code for each failure stage with `correlationId`.
