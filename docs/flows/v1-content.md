# GET /api/v1/content

## Purpose

Tenant-scoped content read from Supabase content store. Serves as the cloud-first content bootstrap for tenant rendering.

## Trigger / Caller

- Tenant runtime at build/render time to load `siteConfig` and `pages`.
- Studio for initial content hydration.
- Feature-gated via `SAVE2ROUTES_BETA`.

## Request Contract

- Headers:
  - `Authorization: Bearer <tenant_api_key>`
  - optional `x-correlation-id`
- No body (GET request).

## State Machine Effects

Read-only. No state mutations.

## External Dependencies

- Supabase `tenant_content` (via `tenantContentStore.readTenantContent`)
- Supabase `tenants` (API key lookup)

## Response Contract

- `200`: `{ ok, source, tenantId, tenantSlug, correlationId, updatedAt, contentStatus, namespace, namespaceMatchedKeys, siteConfig, pages, diagnostics }`
  - `source`: always `"supabase"`
  - `contentStatus`: `"ok"` when content found, `"empty_namespace"` when tenant namespace is empty
  - `siteConfig`: object or `null`
  - `pages`: record of normalized slug -> page payload
  - `diagnostics.sourceStore`: `"supabase"`
  - `diagnostics.emptyNamespace`: boolean
- `401`: `ERR_UNAUTHORIZED` — missing bearer key
- `403`: `ERR_INVALID_API_KEY`
- `502`: `ERR_CONTENT_READ_FAILED`
- `503`: `ERR_CONTENT_DISABLED` — feature flag disabled

## Observability

- `save.content.read_success` / `save.content.empty_namespace` metrics.
- Structured logs: `save.content.read_success`, `save.content.empty_namespace`, `save.content.read_failed`, `save.content.disabled`, `save.content.unauthorized`, `save.content.invalid_api_key`.

## Failure Modes & Recovery

- Supabase read fails: returns `502` with error message. Client should retry.
- Empty namespace: returns `200` with `contentStatus: "empty_namespace"`. This is expected for newly provisioned tenants before first hot save or snapshot.

## Verification Gates

- Call with valid API key and verify:
  - `source` is `"supabase"`.
  - `pages` contains expected page slugs.
  - `siteConfig` is populated after at least one hot save.

## Migration Notes

This endpoint previously read from Vercel Edge Config. It now reads from Supabase `tenantContentStore`.
The `source` field changed from `"edge"` to `"supabase"`.
