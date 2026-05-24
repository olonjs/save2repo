# POST /api/v1/forms/submit

## Purpose

Ingests tenant contact form submissions with configurable storage policy, email delivery via Resend, and comprehensive audit trail.

## Trigger / Caller

- Tenant website contact/inquiry forms (public-facing).
- Authenticated via tenant API key (not user session).

## Request Contract

- Headers:
  - `Authorization: Bearer <tenant_api_key>`
  - optional `Idempotency-Key`
  - optional `x-correlation-id`
- Body: form data payload (arbitrary JSON, typically `{ name, email, message, ... }`)

## State Machine Effects

1. Resolve tenant via API key.
2. Idempotency replay check (`tenant_id + idempotency_key` in `leads` table).
3. IP+tenant rate-limit window check (configurable via `FORMS_RATE_LIMIT_PER_MINUTE`, default 5).
4. Persist lead in DB (`leads`) + audit event (`lead_events`).
5. Best-effort GitHub commit (`src/data/leads/...`) when storage policy allows:
   - Gated by `forms_git_storage_enabled` and `forms_storage_policy` on tenant.
   - Runtime guardrail: public repos force DB-only storage.
   - Configurable retries (`FORMS_GITHUB_RETRIES`, default 2).
6. Resolve email template (`resolveTenantEmailTemplate`).
7. Send notification email via Resend with `reply_to` (if valid email in payload).
8. Send sender confirmation email if template supports it.
9. Update `delivery_status` on success/failure.
10. On permanent delivery failure: enqueue to `lead_dlq`.

## External Dependencies

- Supabase `leads`, `lead_events`, `tenants`
- GitHub API (optional commit for Git storage policy)
- Resend API (email delivery)

## Response Contract

- `200`: submit processed successfully
- `202`: submit processed with `partialSuccess` (e.g. Git write failed but delivery succeeded)
- `401`: missing bearer key
- `403`: invalid API key
- `429`: `ERR_FORM_RATE_LIMITED` — rate limit exceeded
- `502`: lead persisted but delivery failed (`ERR_RESEND_SEND_FAILED` family)

## Observability

- Metrics and structured logs via `logForm` / `metricForm`.
- Audit trail via `lead_events` table.
- Rate limit violations logged.

## Failure Modes & Recovery

- Idempotent replay: returns cached response if `Idempotency-Key` matches previous submission.
- Rate limited: returns `429`. Client should back off.
- GitHub commit fails: form is still persisted in DB, returns `partialSuccess`.
- Resend delivery fails: lead is persisted, `delivery_status` updated, enqueued to `lead_dlq` for retry.

## Verification Gates

- Submit valid form payload and verify:
  - Lead appears in `leads` table.
  - `lead_events` audit trail created.
  - Notification email received.
  - Idempotent replay returns same response.
