# HotSave Content Store Runbook

## Purpose

Provide an operational checklist for diagnosing and fixing tenant content issues with the Supabase-only content store.

## API Signals

`GET /api/v1/content` returns diagnostics for enterprise operations:

- `contentStatus`: `ok` | `empty_namespace`
- `namespace`: resolved tenant namespace (`t_<tenantId>...`)
- `namespaceMatchedKeys`: number of pages found in tenant payload
- `source`: `supabase`
- `correlationId`: request correlation for tracing

## Store Model

- Table: `tenant_content_store`
- Primary key: `(tenant_id, environment)`
- Payload shape:
  - `{ siteConfig: <object|null>, pages: { <slug>: <pageConfig> } }`

## Triage Checklist

1. Call `GET /api/v1/content` with the tenant API key.
2. If `contentStatus=empty_namespace`, verify the row in `tenant_content_store` for `(tenant_id, 'production')`.
3. Validate `content_jsonb` shape (`siteConfig`, `pages` object).
4. Track with `correlationId` in server logs (`save.content.*` events).

## Recovery Procedure

1. Trigger dashboard snapshot (`HotSave Snapshot`) to rebuild payload from repository JSON.
2. Re-run `GET /api/v1/content` and confirm:
   - `contentStatus=ok`
   - `siteConfig != null` or `pages` not empty
3. If still empty, inspect tenant GitHub repository paths:
   - `src/data/config/site.json`
   - `src/data/pages/*.json`

## Validation Matrix

- Valid key + populated payload => `200`, `contentStatus=ok`, no client fallback.
- Valid key + empty payload => `200`, `contentStatus=empty_namespace`, tenant shows cloud error path.
- Invalid key => `403`, `ERR_INVALID_API_KEY`.

## Rollout

1. Validate first on tenant clone (`hotsave`).
2. Promote verified client changes to DNA.
3. Monitor `save.content.empty_namespace` and `save.content.read_success` metrics.

## Smoke Test (Read + Write Supabase)

1. Write path smoke (`hotSave + save2repo`):
   - `CLOUD_API_BASE_URL=https://app.jsonpages.io/api/v1`
   - `TENANT_API_KEY=<tenant-key>`
   - run `npm run test:save2:smoke`
2. Read path smoke:
   - call `GET /api/v1/content` with the same tenant key
   - verify `200` and `ok=true`
3. Reload tenant UI and verify no repeated request burst (single-flight client load) and no local flash in cloud mode.
