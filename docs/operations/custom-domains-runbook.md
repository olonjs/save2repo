# Custom Domains Runbook

## Scope

- API surface: `POST/GET /api/v1/tenants/:id/domains`, `GET/DELETE /api/v1/tenants/:id/domains/:domain`, `POST /api/v1/tenants/:id/domains/:domain/verify`
- Reconcile job: `POST /api/v1/internal/domains/reconcile`
- Storage: `tenant_domains`, `tenant_domain_events`, `tenant_domain_dlq`

## SLO Targets

- `add-domain` API success rate >= 99% (excluding external DNS propagation)
- `add-domain` p95 response <= 4s
- `verify-domain` recovery from retryable Vercel failures <= 15m (via reconcile + DLQ)

## Alerts

- High Vercel upstream failure ratio (>10% in 5m)
- DLQ pending items > 25 for > 10m
- Domains stuck in `verifying` for > 60m

## Incident Checklist

1. Identify affected `tenant_id`, `domain`, `correlation_id`
2. Inspect `tenant_domain_events` timeline for operation and status transitions
3. Inspect `tenant_domain_dlq` for retryable failures and root cause
4. Verify Vercel project linkage (`tenants.vercel_project_id`)
5. Verify DNS challenge records from `tenant_domains.verification_targets`
6. Trigger reconcile endpoint with scoped limit if needed
7. If conflict/takeover detected, keep status `conflict` and provide TXT/CNAME ownership instructions

## Common Recovery Actions

- **Retry add/verify/remove safely**: replay with `Idempotency-Key`
- **Drain DLQ manually**: set `resolved_at` after successful replay
- **Rollback**: remove domain from Vercel + soft-delete row (`deleted_at`)

## Security Controls

- Enforced tenant access with server-side guard (`assertTenantAccess`)
- BOLA/IDOR protection: every route validates tenant ownership/role before domain operation
- Domain governance gated by active paid entitlement
- Technical anti-abuse limits (rate limit + max domains per tenant) are backend enforced
