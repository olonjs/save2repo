# GET /api/v1/licensing/subscription-summary

## Purpose

Returns a normalized billing summary for the Billing tab in the tenant dashboard. Resolves plan, status, renewal date, entitlement count, and portal availability.

## Trigger / Caller

- Dashboard Billing tab on mount.
- Polling after subscription changes.

## Request Contract

- Auth: `requireRequestUser`
- Query:
  - `tenant_id` (optional UUID; when present, verifies owner access)
  - `correlation_id` (optional)
- Headers: optional `x-correlation-id`

## State Machine Effects

Read-only. No state mutations.

## External Dependencies

- Supabase `billing_intents` (license state lookup, tenant-scoped then user-scoped fallback)
- Supabase `tenants` (ownership verification when `tenant_id` provided)

## Response Contract

- `200`: `{ correlationId, tenantId, planCode, status, renewalAt, currentPeriodEnd, entitlementCount, canManageBilling, updatedAt, portalUrl }`
  - `status`: normalized to `active | past_due | unknown`
    - `active`: subscription statuses `active`, `on_trial`, `trialing`, `paid`, or intent states `licensed_ready*`
    - `past_due`: subscription statuses `past_due`, `unpaid`, `overdue`, `paused`
    - `unknown`: no matching intent found
  - `canManageBilling`: `true` when `ls_customer_id` is present
  - `entitlementCount`: count of unassigned entitlements (`licensed_ready_unassigned` with `tenant_id = null`)
  - Fallback chain: tenant-scoped intent -> user-scoped intent -> default safe payload
- `400`: `ERR_TENANT_ID_INVALID`
- `404`: `ERR_TENANT_NOT_FOUND` (tenant not owned by user)
- `500`: `ERR_ENTITLEMENT_COUNT_READ_FAILED`

## Observability

- Standard auth logging via `requireRequestUser`.

## Failure Modes & Recovery

- Entitlement count query fails: returns `500`. All other data resolves independently.
- No billing intent found: returns safe defaults (`planCode: null`, `status: "unknown"`, `canManageBilling: false`).

## Verification Gates

- Call with valid user + `tenant_id` and verify:
  - `planCode` matches the subscribed plan.
  - `status` is `active` after successful payment.
  - `entitlementCount` reflects unassigned entitlements.
