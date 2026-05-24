# `GET /api/v1/licensing/checkout-status`

## Purpose

Return current billing intent status for subscribe flow, including automatic recovery when stored checkout is stale/unsafe.

## Trigger / Caller

- Primary caller: `src/app/dashboard/page.tsx` (polling + resume logic)
- Used after `create-checkout` and after LS return redirect

## Request Contract

- Method: `GET`
- Auth: required (`requireRequestUser`)
- Query:
  - `plan` (required)
  - `tenant_id` (optional UUID)
  - `correlation_id` (optional)
- Header:
  - `x-correlation-id` optional
- Lookup precedence:
  1. by `tenant_id`
  2. else by `correlation_id`
  3. else latest by `user_id + plan_code`

## State Machine Effects

- Read-only endpoint (does not mutate rows)
- Normalizes legacy state:
  - `licensed_ready` + tenant -> `licensed_ready_assigned`
  - `licensed_ready` + no tenant -> `licensed_ready_unassigned`
- Checkout recovery rule:
  - if state is pending (`checkout_created`/`payment_pending`) but checkout cannot be safely reused, effective `state` is downgraded to `bridge_ready` and checkout fields are nulled

## External Dependencies

- Supabase: `billing_intents`
- Environment context for reuse checks:
  - `LS_STORE_ID`, `LS_VARIANT_*`, `LS_CHECKOUT_REUSE_MAX_AGE_MS`

## Response Contract

- `200`:
  - `correlationId`, `state` (effective), `originalState`, `normalizedState`
  - `checkoutId`, `checkoutUrl`, `checkoutReusable`, `checkoutRecoveryRequired`, `checkoutRecoveryReasons`
  - `installationId`, `tenantId`, `variantId`, `storeId`, `lastErrorCode`, `lastErrorMessage`
- `400`:
  - `ERR_PLAN_INVALID`, `ERR_TENANT_ID_INVALID`
- `500`:
  - `ERR_CHECKOUT_STATUS_READ_FAILED`

## Observability

- Info log keyspace: `[licensing.checkout-status]` when recovery is required
- Minimum keys:
  - `correlationId`, `eventKey`, `userId`, `planCode`, `tenantId`, `checkoutRecoveryReasons`, `checkoutAgeMs`, `runtimeHost`, `vercelEnv`

## Failure Modes & Recovery

- Missing row -> returns synthetic authenticated baseline (`state=authenticated`)
- Stale/unsafe checkout -> client should re-run checkout creation from `bridge_ready`
- DB read failure -> hard `500`, retry request

## Verification Gates

- Legacy `licensed_ready` normalization works for assigned/unassigned rows
- Pending stale checkout results in `checkoutRecoveryRequired=true` and effective `bridge_ready`
- Fresh matching pending checkout keeps `checkoutReusable=true` with usable URL
- Correlation-based lookup returns latest intent for that correlation

