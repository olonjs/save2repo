# POST /api/v1/hotSave

## Purpose

Low-latency hot save into Supabase content store, with tenant dirty-state tracking.
Supports three modes: single page, single config, or combined bundle (page + siteConfig in one call).

## Trigger / Caller

- Studio Save button in hot mode (new clients).
- Feature-gated rollout path (`SAVE2ROUTES_BETA` + `SAVE_HOT_ENABLED`).

## Request Contract

- Headers:
  - `Authorization: Bearer <tenant_api_key>`
  - optional `Idempotency-Key`
  - optional `x-correlation-id`
- Body single-entity mode:
  - `slug: string`
  - `type: "page" | "config"`
  - `data: unknown`
- Body bundle mode:
  - `slug: string`
  - `page: unknown`
  - `siteConfig: unknown`

## State Machine Effects

1. Resolve tenant by API key.
2. Determine save mode:
   - **bundle** (when both `page` and `siteConfig` present): reads current content, merges page into existing pages map, replaces full content via `replaceTenantContent`.
   - **page**: upserts single page via `upsertTenantPage`.
   - **config**: upserts siteConfig via `upsertTenantSiteConfig`.
3. Mark tenant dirty:
   - `unsynced_changes_count += 1`
   - `last_hot_save_at = now`
   - `sync_status = "dirty"`
   - `updated_at = now`

## External Dependencies

- Supabase `tenant_content` (via `tenantContentStore`)
- Supabase `tenants` (state tracking)

## Response Contract

- `200`: `{ ok, correlationId, idempotencyKey, key, savedEntities, unsyncedChangesCount, savedAt }`
  - `savedEntities`: `["page"]`, `["config"]`, or `["page", "config"]` for bundle
  - `key`: namespaced key (e.g. `t_<id>_page_home` or `t_<id>_bundle_home`)
- `400`: `ERR_BAD_REQUEST` — missing slug or invalid payload
- `401`: `ERR_UNAUTHORIZED` — missing bearer key
- `403`: `ERR_INVALID_API_KEY`
- `500`: `ERR_HOTSAVE_STATE_UPDATE_FAILED` — store write succeeded but tenant state update failed
- `502`: `ERR_HOTSAVE_WRITE_FAILED` — content store write failed
- `503`: `ERR_HOTSAVE_DISABLED` — feature flags disabled

## Observability

- `hotsave_success` / `hotsave_error` metrics (with `type`, `tenantId`, `elapsedMs`).
- Structured logs: `hotsave.completed`, `hotsave.failed`, `hotsave.state_update_failed`.

## Failure Modes & Recovery

- Content store write fails: dirty counter not incremented, returns `502`.
- DB state update fails after store write: returns explicit `500` with `ERR_HOTSAVE_STATE_UPDATE_FAILED`. Content is saved but tenant state is stale; next successful hot save will correct the counter.

## Verification Gates

- Submit valid single-entity payload and verify:
  - Content exists in Supabase store for tenant namespace.
  - `unsynced_changes_count` increments.
  - `sync_status` becomes `dirty`.
- Submit valid bundle payload and verify:
  - Both page and siteConfig persisted.
  - `savedEntities` contains `["page", "config"]`.

## Migration Notes

This endpoint replaces the former `POST /api/v1/save2edge` which wrote to Vercel Edge Config.
Storage was migrated from Edge Config REST API to Supabase `tenantContentStore`.
The bundle mode (page + siteConfig combined) is new and was not available in save2edge.
