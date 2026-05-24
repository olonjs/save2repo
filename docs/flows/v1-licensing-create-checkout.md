# `POST /api/v1/licensing/create-checkout`

## Purpose

Create (or safely reuse) LemonSqueezy checkout for a user/plan and optional tenant, with anti-stale protections and state persistence.

## Trigger / Caller

- Primary caller: `src/app/dashboard/page.tsx`
- Called after `bridge-status` is `bridge_ready`

## Request Contract

- Method: `POST`
- Auth: required (`requireRequestUser`)
- Body:
  - `planCode` (required)
  - `installationId` (required integer)
  - `tenantId` (optional UUID)
  - `forceNew` (optional boolean)
- Header:
  - `x-correlation-id` optional
- Hard validations:
  - invalid plan -> `400 ERR_PLAN_INVALID`
  - invalid installation -> `400 ERR_INSTALLATION_ID_INVALID`
  - invalid/missing tenant relation -> `ERR_TENANT_ID_INVALID` / `ERR_TENANT_NOT_FOUND` / `ERR_TENANT_INSTALLATION_MISMATCH`

## State Machine Effects

- Tenant-scoped guard:
  - if existing state already licensed (`licensed_ready` or `licensed_ready_assigned`) -> `409 ERR_TENANT_PLAN_ALREADY_LICENSED`
- Reuse path (when `forceNew !== true`):
  - reuses only if state in `{checkout_created,payment_pending}` and checkout URL/context is fresh and consistent
  - freshness: `LS_CHECKOUT_REUSE_MAX_AGE_MS` (default 15m)
  - context match: same LS store, variant, and valid LemonSqueezy URL
- New checkout path:
  - creates LS checkout with `custom_data` (`userId`, optional `tenantId`, `installationId`, `planCode`, `correlationId`)
  - persists `billing_intents.state = checkout_created`
- On LS API failure:
  - persists `bridge_ready` + `last_error_code/message`

## External Dependencies

- Supabase: `billing_intents`, `tenants`
- LemonSqueezy API: `POST /v1/checkouts`
- GitHub App installation resolver
- Environment:
  - `LS_API_KEY`, `LS_STORE_ID`, `LS_VARIANT_*`, `NEXT_PUBLIC_APP_URL`

## Response Contract

- `200` reuse/new:
  - `correlationId`, `state`, `checkoutId`, `checkoutUrl`, `tenantId`, `reused`
- `409`:
  - `ERR_TENANT_PLAN_ALREADY_LICENSED`
- `500`:
  - `ERR_LS_CONFIG_MISSING`
  - `ERR_CHECKOUT_STATE_PERSIST_FAILED`
  - `ERR_GITHUB_APP_CONFIG_MISSING`
  - `ERR_CHECKOUT_CREATE_UNHANDLED`
- `502`:
  - `ERR_LS_CHECKOUT_CREATE_FAILED`
  - `ERR_LS_CHECKOUT_RESPONSE_INVALID`

## Observability

- Info/error logs keyspace: `[licensing.create-checkout]`
- Minimum keys:
  - `correlationId`, `eventKey`, `userId`, `tenantId`, `planCode`, `installationId`, `reason`, `runtimeHost`, `vercelEnv`
- Reuse rejection reasons explicitly logged (`staleCheckout`, `variantMismatch`, etc.)

## Failure Modes & Recovery

- Invalid LS config -> return config hints, fix env and redeploy
- Stale/invalid checkout context -> reject reuse and force new checkout
- LS transient failure -> client can retry with same plan/install context
- Persist failure -> server returns hard error; no silent success

## Verification Gates

- `forceNew=true` always bypasses reuse
- Reuse accepted only for safe URL + fresh age + matching store/variant
- Tenant with active license is blocked with `409`
- LS checkout response missing URL/id returns `ERR_LS_CHECKOUT_RESPONSE_INVALID`
- Successful path writes `checkout_created` and clears last error fields

