# `POST /api/v1/webhooks/ls`

## Purpose

Process LemonSqueezy payment events, enforce idempotency, and advance `billing_intents` state without regressions.

## Trigger / Caller

- External caller: LemonSqueezy webhook delivery
- Not called by frontend directly

## Request Contract

- Method: `POST`
- Auth: HMAC signature via `x-signature` and `LS_WEBHOOK_SECRET`
- Body: raw JSON payload from LS
- Validations:
  - missing secret -> `500 ERR_LS_WEBHOOK_SECRET_MISSING`
  - invalid signature -> `401 ERR_LS_WEBHOOK_SIGNATURE_INVALID`
  - invalid JSON -> `400 ERR_LS_WEBHOOK_JSON_INVALID`
- Custom data extraction supports multiple payload paths (`meta.custom_data`, `meta.custom`, etc.)

## State Machine Effects

- Idempotency:
  - `billing_webhook_events` insert by unique `event_key`
  - duplicate (`23505`) returns `{ ok: true, duplicate: true }`
- Context resolution:
  - resolves `userId`, `tenantId`, `correlationId`, `planCode`
  - ignores events with missing user or invalid plan
- State transition:
  - success events (`order_created`, `subscription_created`, `subscription_payment_success`) -> `licensed_ready_assigned` if tenant present else `licensed_ready_unassigned`
  - non-success events -> `payment_pending`
  - no-regression: once licensed, never downgraded to pending
- Persistence strategy:
  - update existing intent by `id` when found
  - else upsert by `tenant_id,plan_code` for tenant-scoped events
  - else insert for unassigned events

## External Dependencies

- Supabase:
  - `billing_webhook_events`
  - `billing_intents`
- Crypto HMAC SHA256

## Response Contract

- `200` success:
  - `{ ok: true, eventName, state, correlationId }`
- `200` ignored/duplicate:
  - `{ ok: true, ignored|duplicate: true, reason? }`
- `500`:
  - `ERR_LS_WEBHOOK_EVENT_PERSIST_FAILED`
  - `ERR_LS_WEBHOOK_STATE_READ_FAILED`
  - `ERR_LS_WEBHOOK_STATE_PERSIST_FAILED`

## Observability

- Logs keyspace: `[licensing.webhook.ls]`
- Minimum keys:
  - `correlationId`, `eventKey`, `eventName`, `userId`, `tenantId`, `planCode`, `webhookCorrelationId`, `customDataPath`, `previousState`, `preventedRegression`

## Failure Modes & Recovery

- Signature mismatch -> reject hard, fix webhook secret/config
- Duplicate delivery -> safe no-op via idempotency table
- Missing custom user/plan -> ignored with explicit reason
- State persist failure -> LS retries can recover after DB issue fixed

## Verification Gates

- Valid signed payload transitions to expected licensed state
- Duplicate webhook delivery returns `duplicate=true` without double-processing
- Licensed intents are not regressed back to `payment_pending`
- Unassigned paid events create `licensed_ready_unassigned` intents

