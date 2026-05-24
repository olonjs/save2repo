# Internal Domains Admin

## Purpose

Administrative and operational endpoints for domain lifecycle management. All require `requireDomainsAdmin` auth (except reconcile which also accepts cron secret).

---

## GET /api/v1/internal/domains/events

### Request Contract

- Auth: `requireDomainsAdmin`
- Query:
  - `limit` (default 100, max 500)
  - `tenant_id` (optional filter)
  - `domain` (optional filter, post-query)

### Response Contract

- `200`: `{ items: [{ id, tenant_id, tenant_domain_id, actor_user_id, event_name, event_status, correlation_id, payload, created_at, domain }] }`
- `500`: `ERR_DOMAIN_EVENTS_READ_FAILED`

---

## GET /api/v1/internal/domains/dlq

### Request Contract

- Auth: `requireDomainsAdmin`
- Query:
  - `limit` (default 50, max 200)
  - `pending` (default `1`; set `0` to include resolved)

### Response Contract

- `200`: `{ items: [{ id, tenant_id, tenant_domain_id, operation, domain, attempts, last_error_code, last_error_message, payload, next_retry_at, last_attempt_at, resolved_at, created_at }] }`
- `500`: `ERR_DOMAIN_DLQ_READ_FAILED`

---

## POST /api/v1/internal/domains/dlq/:id/retry

### Request Contract

- Auth: `requireDomainsAdmin`
- Path param: `id` (DLQ item UUID)

### State Machine Effects

1. Load DLQ item; skip if already resolved.
2. Resolve tenant Vercel project ID.
3. Branch on `operation`:
   - `add_domain`: re-add domain on Vercel, update `tenant_domains` status and `verification_targets`.
   - `remove_domain`: remove from Vercel, soft-delete `tenant_domains`.
   - `status_or_verify` / `reconcile` / other: verify + get status, update `tenant_domains` status and `verification_targets`.
4. Mark DLQ item as resolved on success.
5. On failure: increment attempts, schedule next retry (+5 min).

`verification_targets` is provider-first: internal retry stores checks returned by Vercel (including recommended config records) and does not synthesize custom TXT ownership records.

### Response Contract

- `200`: `{ ok: true }` or `{ ok: true, alreadyResolved: true }`
- `404`: `ERR_DOMAIN_DLQ_NOT_FOUND`
- `409`: `ERR_VERCEL_PROJECT_MISSING`
- `500`: `ERR_DOMAIN_DLQ_ITEM_READ_FAILED` or `ERR_DOMAIN_DLQ_RETRY_FAILED`

---

## GET /api/v1/internal/domains/metrics

### Request Contract

- Auth: `requireDomainsAdmin`

### Response Contract

- `200`: `{ windowHours: 24, events: { success, error, pending }, pendingDomains, stuckVerifying, dlqBacklog }`
  - `stuckVerifying`: domains in `pending_dns` or `verifying` status for > 1 hour
  - `dlqBacklog`: unresolved DLQ item count
- `500`: `ERR_DOMAIN_METRICS_READ_FAILED`

---

## POST /api/v1/internal/domains/reconcile

### Request Contract

- Auth: `requireDomainsAdmin` OR `x-cron-secret` header matching `INTERNAL_DOMAINS_CRON_SECRET`
- Query: `limit` (default 50, max 200)

### State Machine Effects

1. Load domains in `pending_dns` or `verifying` status not updated in the last 5 minutes.
2. For each domain:
   - Fetch Vercel domain status + config.
   - If not verified, attempt verification.
   - Update `tenant_domains` with derived status and provider-driven `verification_targets`.
   - `conflict` only when provider reports real conflicts (`config.conflicts` non-empty).
  - Domain is promoted to `active` only when `verified=true` and `config.misconfigured=false`.
  - `config.misconfigured=true` or `config.configuredBy=null` keeps the domain in `pending_dns`.
   - On failure: enqueue to DLQ.

Reconcile processes stale `tenant_domains` rows (`pending_dns` / `verifying`) and does not directly drain existing DLQ backlog.

### Response Contract

- `200`: `{ ok: true, processed, updated, failed }`
- `500`: `ERR_DOMAIN_RECONCILE_LOAD_FAILED`

---

## External Dependencies

- Vercel Domains API (`vercelAddDomain`, `vercelRemoveDomain`, `vercelVerifyDomain`, `vercelGetDomainStatus`, `vercelGetDomainConfig`)
- Supabase `tenant_domains`, `tenant_domain_events`, `tenant_domain_dlq`, `tenants`

## Observability

- DLQ metrics available via `/api/v1/internal/domains/metrics`.
- Event audit trail via `/api/v1/internal/domains/events`.
