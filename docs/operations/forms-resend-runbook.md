# Forms + Resend Runbook

## Scope

This runbook covers incidents for:
- `POST /api/v1/forms/submit`
- `POST /api/v1/webhooks/resend`
- storage policy guardrail for public repositories (`db_only_public_repo`)

## SLO Baseline

- Submit API success (2xx): `>= 99.9%`
- Resend webhook signature valid rate: `>= 99.99%`
- DLQ unresolved older than 15 minutes: `0` target

## Key Metrics

- `forms.metric form_submit_success`
- `forms.metric form_submit_error`
- `forms.metric form_submit_rate_limited`
- `forms.metric form_storage_github_error`
- `forms.metric resend_webhook_signature_failed`
- `forms.metric resend_webhook_processed`

## Alert Rules

- **High submit failures**
  - Trigger: `form_submit_error` > 3% over 10m
  - Action: inspect Resend provider health + env config
- **Webhook signature failures**
  - Trigger: `resend_webhook_signature_failed` > 5 in 5m
  - Action: check `RESEND_WEBHOOK_SECRET` rotation mismatch
- **DLQ growth**
  - Trigger: unresolved `lead_dlq` items > 10 for 15m
  - Action: retry failed operations and verify provider status

## Incident Playbooks

### 1) Submit returns `ERR_RESEND_SEND_FAILED`

1. Verify `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
2. Check provider response from logs (`scope=forms`, message `form.submit.delivery_failed`).
3. Confirm lead persisted in `leads` with `delivery_status=error`.
4. Inspect `lead_dlq` and retry operation once provider is healthy.

### 2) Webhook returns `ERR_RESEND_WEBHOOK_SIGNATURE_INVALID`

1. Confirm webhook target URL is correct: `/api/v1/webhooks/resend`.
2. Compare configured webhook secret in Resend vs runtime `RESEND_WEBHOOK_SECRET`.
3. Ensure no proxy rewrites request body/headers (`svix-*` must be intact).

### 3) Public repository detected unexpectedly

1. Check tenant row: `forms_git_storage_enabled`, `forms_storage_policy`.
2. Runtime guardrail forces `db_only_public_repo` when repo is public.
3. Validate GitHub repo privacy and installation permissions.

## Recovery SQL Snippets

```sql
-- Inspect latest lead delivery failures
select id, tenant_id, resend_id, delivery_status, last_error_code, created_at
from leads
where delivery_status = 'error'
order by created_at desc
limit 50;
```

```sql
-- Inspect unresolved DLQ
select id, tenant_id, lead_id, operation, attempts, last_error_code, next_retry_at
from lead_dlq
where resolved_at is null
order by created_at desc
limit 100;
```

## Ownership

- Primary: Backend API on-call
- Secondary: Platform operations
