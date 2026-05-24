# API Flows Reference

This folder is the runtime flow source of truth for `src/app/api/v1/**/route.ts`.

## Scope

- Version: `v1`
- Endpoint coverage target: `41` route handlers
- Focus: trigger/caller, contract, state effects, dependencies, observability, recovery, verification gates

## Naming Convention

- Endpoint files: `v1-<area>-<endpoint>.md`
- Cross-endpoint orchestration: `v1-orchestration-<flow-name>.md`

## Endpoint Map

### Save & Content
- `POST /api/v1/save` -> `v1-save.md`
- `POST /api/v1/save-stream` -> `v1-save-stream.md`
- `POST /api/v1/hotSave` -> `v1-hotSave.md`
- `POST /api/v1/save2repo` -> `v1-save2repo.md`
- `GET /api/v1/content` -> `v1-content.md`
- `POST /api/v1/mcp` -> `v1-mcp.md`
- `GET /api/v1/mcp` -> `v1-mcp.md`

### Assets
- `POST /api/v1/assets/upload` -> `v1-assets-upload.md`
- `GET /api/v1/assets/list` -> `v1-assets-list.md`

### Tenants
- `POST /api/v1/tenants/provision-stream` -> `v1-tenants-provision-stream.md` (includes repository->content-store bootstrap before terminal success)
- `POST /api/v1/tenants/create` -> `v1-tenants-create.md`
- `POST /api/v1/tenants/previews/bootstrap` -> `v1-tenants-previews-bootstrap.md`
- `POST /api/v1/tenants/:id/save2edge-snapshot` -> `v1-tenants-save2edge-snapshot.md`
- `POST /api/v1/tenants/:id/cold-save` -> `v1-tenants-cold-save.md`
- `DELETE /api/v1/tenants/:id` -> `v1-tenants-delete.md`
- `GET /api/v1/tenants/:id/agents` -> `v1-tenants-agents.md`
- `POST /api/v1/tenants/:id/agents` -> `v1-tenants-agents.md`
- `DELETE /api/v1/tenants/:id/agents/:credentialId` -> `v1-tenants-agents.md`
- `POST /api/v1/tenants/:id/admin-keypair` -> `v1-tenants-admin.md`
- `POST /api/v1/tenants/:id/admin-token` -> `v1-tenants-admin.md`

### Tenant Leads
- `GET /api/v1/tenants/:id/leads` -> `v1-tenants-leads.md`
- `GET /api/v1/tenants/:id/leads/:leadId/events` -> `v1-tenants-leads.md`

### Tenant Domains
- `GET /api/v1/tenants/:id/domains` -> `v1-tenants-domains.md`
- `POST /api/v1/tenants/:id/domains` -> `v1-tenants-domains.md`
- `GET /api/v1/tenants/:id/domains/:domain` -> `v1-tenants-domains.md`
- `DELETE /api/v1/tenants/:id/domains/:domain` -> `v1-tenants-domains.md`
- `POST /api/v1/tenants/:id/domains/:domain/verify` -> `v1-tenants-domains.md`
- Contract note: `verification_targets` is provider-first and must reflect runtime checks returned by Vercel.

### Licensing
- `GET /api/v1/licensing/bridge-status` -> `v1-licensing-bridge-status.md`
- `POST /api/v1/licensing/create-checkout` -> `v1-licensing-create-checkout.md`
- `GET /api/v1/licensing/checkout-status` -> `v1-licensing-checkout-status.md`
- `GET /api/v1/licensing/pending-entitlements` -> `v1-licensing-pending-entitlements.md`
- `GET /api/v1/licensing/subscription-summary` -> `v1-licensing-subscription-summary.md`
- `GET /api/v1/licensing/portal` -> `v1-licensing-portal.md`

### GitHub
- `GET /api/v1/github/installations` -> `v1-github-installations.md`
- `GET /api/v1/github/repos` -> `v1-github-repos.md`

### Forms & Webhooks
- `POST /api/v1/forms/submit` -> `v1-forms-submit.md`
- `POST /api/v1/webhooks/ls` -> `v1-webhooks-ls.md`
- `POST /api/v1/webhooks/resend` -> `v1-webhooks-resend.md`

### Other
- `POST /api/v1/link` -> `v1-link.md`

### Internal (admin/cron)
- `GET /api/v1/internal/domains/events` -> `v1-internal-domains.md`
- `GET /api/v1/internal/domains/dlq` -> `v1-internal-domains.md`
- `POST /api/v1/internal/domains/dlq/:id/retry` -> `v1-internal-domains.md`
- `GET /api/v1/internal/domains/metrics` -> `v1-internal-domains.md`
- `POST /api/v1/internal/domains/reconcile` -> `v1-internal-domains.md`
- `POST /api/internal/tenant-preview/reconcile` -> `v1-internal-tenant-preview.md`
- `POST /api/internal/tenant-preview/refresh` -> `v1-internal-tenant-preview.md`

## Cross-Endpoint Orchestration

- Subscribe + payment + entitlement + provision: `v1-orchestration-subscribe-and-provision.md`
- Save Hot + Save Cold orchestration: `v1-orchestration-save2-hot-cold.md`
- Visual pack (all flows): `v1-all-flows-visual.html`

## Required Sections Per Endpoint

1. Purpose
2. Trigger / Caller
3. Request Contract
4. State Machine Effects
5. External Dependencies
6. Response Contract
7. Observability
8. Failure Modes & Recovery
9. Verification Gates

## Caller / Trigger Inventory

- Client callers:
  - `src/app/dashboard/page.tsx`
  - `src/app/dashboard/components/CreateTenantFlow.tsx`
- External triggers:
  - LemonSqueezy webhook deliveries to `POST /api/v1/webhooks/ls`
- Internal/shared dependencies:
  - Supabase (`billing_intents`, `billing_webhook_events`, `tenants`, `licenses`, `tenant_content`, `leads`, `domains`)
  - GitHub App APIs
  - Vercel APIs
  - LemonSqueezy APIs
  - Resend APIs

