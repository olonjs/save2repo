# GET /api/v1/licensing/portal

## Purpose

Resolves a secure LemonSqueezy customer portal URL for subscription management. The client performs a redirect to the portal URL.

## Trigger / Caller

- Dashboard Billing tab "Manage subscription" button.

## Request Contract

- Auth: `requireRequestUser`
- Query:
  - `tenant_id` (optional UUID; when present, verifies owner access)
  - `correlation_id` (optional)
- Headers: optional `x-correlation-id`

## State Machine Effects

1. Resolve `ls_customer_id` from `billing_intents` (tenant-scoped -> user-scoped fallback).
2. Fetch customer from LemonSqueezy API `GET /v1/customers/{id}`.
3. Extract `customer_portal` URL and validate hostname (`*.lemonsqueezy.com`).
4. Best-effort persist `ls_portal_url` on `billing_intents`.

## External Dependencies

- LemonSqueezy API `GET /v1/customers/{id}` (requires `LS_API_KEY`)
- Supabase `billing_intents` (customer ID lookup + portal URL persist)
- Supabase `tenants` (ownership verification)

## Response Contract

- `200`: `{ correlationId, tenantId, customerId, portalUrl }`
- `400`: `ERR_TENANT_ID_INVALID`
- `404`:
  - `ERR_TENANT_NOT_FOUND` — tenant not owned by user
  - `ERR_PORTAL_CUSTOMER_NOT_FOUND` — no `ls_customer_id` in billing intents
  - `ERR_PORTAL_LINK_UNAVAILABLE` — portal URL missing or invalid in provider response
- `500`: `ERR_PORTAL_PROVIDER_CONFIG_MISSING` — `LS_API_KEY` env missing
- `502`: `ERR_PORTAL_PROVIDER_FAILED` — LemonSqueezy API call failed

## Observability

- Console error log `[licensing.portal]` on provider failures with correlation context.

## Failure Modes & Recovery

- No customer mapping: returns `404`. User must complete a purchase first.
- LemonSqueezy API fails: returns `502`. Client should retry.
- Portal URL fails hostname validation: returns `502` as safety measure against URL injection.

## Verification Gates

- Call with a user that has completed a purchase and verify:
  - `portalUrl` is a valid `https://*.lemonsqueezy.com` URL.
  - `customerId` matches the expected LemonSqueezy customer.
