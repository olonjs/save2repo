# Domains UI IA

## Tenant Surface

- Entry point: `dashboard/:id?tab=domains`
- Component tree:
  - `DomainsPanel`
  - `DomainAddForm`
  - `DomainsTable`
  - `DomainStatusCard`
  - `DomainErrorBanner`
  - `DomainDeleteDialog`

## Admin/Ops Surface

- `dashboard/admin/domains`
- `dashboard/admin/domains/dlq`
- Backed by internal read-model APIs:
  - `GET /api/v1/internal/domains/events`
  - `GET /api/v1/internal/domains/dlq`
  - `POST /api/v1/internal/domains/dlq/:id/retry`
  - `GET /api/v1/internal/domains/metrics`

## Data Flow

- Tenant tab uses tenant APIs only (`/api/v1/tenants/:id/domains*`).
- Admin pages use internal APIs with feature flag `DOMAINS_ADMIN_UI_ENABLED=1`.
- All mutations use correlation-id and idempotency-key headers.

## UX Rules

- `pending_dns/verifying` rows show clear DNS guidance.
- `conflict` rows show takeover-safe messaging.
- Destructive actions are disabled while in-flight.
- Refresh remains explicit and also auto-polls pending rows.
