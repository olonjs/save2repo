# Tenant Custom Domains

## Purpose

Manage custom domain lifecycle for a tenant: add, verify, check status, and remove domains via the Vercel Domains API. Failed operations are enqueued to a DLQ for automatic or manual retry.

## Trigger / Caller

- Dashboard domain settings UI.
- Domain status polling after DNS configuration.

---

## GET /api/v1/tenants/:id/domains

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(editor)` + `assertDomainGovernance`
- No body.

### State Machine Effects

Read-only. Returns all non-deleted domains for the tenant.

### Response Contract

- `200`: `{ correlationId, tenantId, domains: [{ id, domain, status, verification_method, verification_targets, created_at, updated_at, verified_at, last_error_code, last_error_message }] }`
- `403`: tenant access denied or domain governance check failed
- `500`: `ERR_DOMAIN_LIST_FAILED`

---

## POST /api/v1/tenants/:id/domains

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(admin)` + `assertDomainGovernance`
- Rate limit: `enforceDomainMutationRateLimit`
- Headers: optional `Idempotency-Key`
- Body: `{ domain: string }`

### State Machine Effects

1. Normalize and validate domain (`assertDomainPolicy`).
2. Idempotency replay check on `domain.add.completed` event.
3. Check for existing domain (reuse if same tenant, `409` if different tenant).
4. Insert `tenant_domains` row with `status: pending_dns`.
5. Add domain to Vercel project (`vercelAddDomain`).
6. Fetch Vercel domain status + config and derive status (`active` / `conflict` / `pending_dns` / `verifying`).
7. Update `tenant_domains` with verification targets from provider checks and status.
   - No synthetic TXT challenge is generated.
   - `verification_targets` is provider-first and includes checks from Vercel payloads (`verification`/`checks`) and recommended records from config (`recommendedCNAME`/`recommendedIPv4`) when present.
   - If provider does not return any checks, keep `verification_targets.checks` empty until next refresh/verify/reconcile.
   - `conflict` is used only when provider reports real conflicts (`config.conflicts` non-empty), not for generic DNS misconfiguration.
  - Domain is promoted to `active` only when provider reports both `verified=true` and `config.misconfigured=false`.
  - If provider reports `config.misconfigured=true` or `config.configuredBy=null`, domain remains `pending_dns`.
8. On Vercel failure: set domain to `error`, enqueue to `tenant_domain_dlq`.

### Response Contract

- `200`: domain reused (already exists for same tenant)
- `201`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `400`: domain policy violation
- `409`: `ERR_DOMAIN_CONFLICT` (domain belongs to another tenant) or `ERR_VERCEL_PROJECT_MISSING`
- `429`: mutation rate limit exceeded
- `500`: `ERR_DOMAIN_PERSIST_FAILED`
- `502`: `ERR_VERCEL_DOMAIN_ADD_FAILED`

---

## GET /api/v1/tenants/:id/domains/:domain

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(editor)` + `assertDomainGovernance`
- Query: `verify=0` to skip auto-verification (default: verify on read).

### State Machine Effects

1. Look up domain in `tenant_domains`.
2. Fetch Vercel domain status + config.
3. If `verify` not disabled and domain not yet verified, trigger `vercelVerifyDomain`.
4. Update `tenant_domains` with latest status and verification targets.
5. On failure: enqueue to `tenant_domain_dlq`.

### Response Contract

- `200`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `409`: `ERR_VERCEL_PROJECT_MISSING`
- `502`: `ERR_DOMAIN_STATUS_FAILED`

---

## DELETE /api/v1/tenants/:id/domains/:domain

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(admin)`
- Rate limit: `enforceDomainMutationRateLimit`
- Headers: optional `Idempotency-Key`

### State Machine Effects

1. Idempotency replay check on `domain.remove.completed` event.
2. Look up domain in `tenant_domains`.
3. Remove domain from Vercel project (`vercelRemoveDomain`). Ignores 404 from Vercel.
4. Soft-delete: set `status: deleted`, `deleted_at: now`.
5. On Vercel failure (non-404): enqueue to `tenant_domain_dlq`.

### Response Contract

- `200`: `{ correlationId, tenantId, domain: { id, domain, status: "deleted" } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `429`: mutation rate limit exceeded
- `502`: `ERR_DOMAIN_REMOVE_FAILED`

---

## POST /api/v1/tenants/:id/domains/:domain/verify

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(admin)` + `assertDomainGovernance`

### State Machine Effects

1. Look up domain in `tenant_domains`.
2. Call `vercelVerifyDomain` + `vercelGetDomainStatus` (+ config).
3. Derive status from provider fields (`verified`, `verification`, `config.misconfigured`, `config.configuredBy`, `config.conflicts`) and update `tenant_domains`.
4. On failure: enqueue to `tenant_domain_dlq`.

### Response Contract

- `200`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `409`: `ERR_VERCEL_PROJECT_MISSING`
- `502`: `ERR_DOMAIN_VERIFY_FAILED`

---

## External Dependencies

- Vercel Domains API (`vercelAddDomain`, `vercelRemoveDomain`, `vercelVerifyDomain`, `vercelGetDomainStatus`, `vercelGetDomainConfig`)
- Supabase `tenant_domains`, `tenant_domain_events`, `tenant_domain_dlq`, `tenants`

## Observability

- Metrics: `domain_list_success`, `domain_add_success/error`, `domain_status_refresh_success/error`, `domain_remove_success/error`, `domain_verify_success/error`
- Structured logs via `logDomain` with severity levels.
- All mutations emit `tenant_domain_events` audit records.

## Failure Modes & Recovery

- Vercel API failures are caught and persisted in `tenant_domain_dlq` with retry scheduling.
- DLQ items can be retried via `POST /api/v1/internal/domains/dlq/:id/retry`.
- Reconcile cron (`POST /api/v1/internal/domains/reconcile`) automatically processes stale pending/verifying domains using the same provider-check extraction contract.
