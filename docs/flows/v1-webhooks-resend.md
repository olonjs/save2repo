# POST /api/v1/webhooks/resend

## Purpose

Processes Resend delivery status webhooks to update lead delivery state. Provides real-time visibility into email delivery success/failure.

## Trigger / Caller

- Resend webhook deliveries (external trigger).
- Events: `email.sent`, `email.delivered`, `email.bounced`, `email.complaint`.

## Request Contract

- Security:
  - Svix signature verification via headers `svix-id`, `svix-timestamp`, `svix-signature`
  - Secret env: `RESEND_WEBHOOK_SECRET`
- Body: raw JSON payload from Resend.
- No user auth required.

## State Machine Effects

1. Verify Svix signature and parse JSON.
2. Persist raw event in `lead_webhook_events` (idempotency on `webhook_event_key`, duplicate returns `{ ok: true, duplicate: true }`).
3. Map Resend event types to delivery statuses:
   - `email.sent` -> `sent`
   - `email.delivered` -> `delivered`
   - `email.bounced` -> `error`
   - `email.complaint` -> `warning`
4. Update lead `delivery_status` via `resend_id` match.
5. Append `lead_events` audit record with event details.
6. Mark `lead_webhook_events` as processed.

## External Dependencies

- Supabase `lead_webhook_events` (raw event persistence + idempotency)
- Supabase `leads` (delivery status update)
- Supabase `lead_events` (audit trail)

## Response Contract

- `200`: `{ ok: true, eventType, resendId, status }` — processed successfully
- `200`: `{ ok: true, duplicate: true }` — idempotent replay
- `400`: `ERR_RESEND_WEBHOOK_JSON_INVALID`
- `401`: `ERR_RESEND_WEBHOOK_SIGNATURE_INVALID`
- `500`:
  - `ERR_RESEND_WEBHOOK_CONFIG_MISSING` — `RESEND_WEBHOOK_SECRET` not set
  - `ERR_RESEND_WEBHOOK_INSERT_FAILED` — failed to persist webhook event

## Observability

- `resend_webhook_signature_failed` metric on signature failure.
- `resend_webhook_processed` metric with `tenantId` and `status`.
- Structured logs via `logForm`.

## Failure Modes & Recovery

- Signature failure: returns `401`. Check `RESEND_WEBHOOK_SECRET` alignment.
- Duplicate event: returns `200` with `duplicate: true`. Safe to replay.
- Lead not found by `resend_id`: event is still persisted but no lead update occurs.

## Verification Gates

- Verify webhook delivery in Resend dashboard shows `200`.
- After `email.delivered` event, verify lead `delivery_status` is `delivered`.
- Check `lead_webhook_events` for raw event persistence.
