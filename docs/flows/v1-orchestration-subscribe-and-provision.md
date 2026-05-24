# `v1` Orchestration: Subscribe -> Payment -> Entitlement -> Provision

## Purpose

Describe end-to-end enterprise flow across licensing, webhook, decision UI, and tenant provisioning, including anti-regression controls.

## Trigger / Caller

- Entry points:
  - Dashboard subscribe action
  - Dashboard resume from pending entitlement banner (FIFO)
- Core client orchestrators:
  - `src/app/dashboard/page.tsx`
  - `src/app/dashboard/components/CreateTenantFlow.tsx`

### Subscribe entry URL contract

The Subscribe action is a deep link into the dashboard. The client reads query params in `src/app/dashboard/page.tsx` (lines ~395-406) and, when `intent=subscribe` is present together with a valid `plan`, automatically kicks off `runSubscribeFlow()`.

Base URL:

```
https://<dashboard-host>/dashboard?intent=subscribe&plan=<starter|pro|business>
```

Recognized query parameters:

| Param | Required | Accepted values | Notes |
|---|---|---|---|
| `intent` | yes | `subscribe` | triggers `runSubscribeFlow` |
| `plan` | yes | `starter` \| `pro` \| `business` | validated by `isPlanCode` |
| `source` | no | `cloud` \| `app` | if omitted, derived from `document.referrer` (hostname `cloud.jsonpages.io` -> `cloud`, otherwise `app`) |
| `installation_id` | no | GitHub App installation id (number) | preselects the bridge installation |
| `tenant_id` | no | UUID v4 | for upgrade/rebind of an existing tenant |
| `correlation_id` | no | free string | end-to-end trace id shared across landing, licensing APIs and LS webhook |

Auth behavior:

- If the user is not authenticated, the dashboard redirects to `/?next=/dashboard?<search-params>` preserving the full query string, so the Subscribe flow automatically resumes after login (see `page.tsx` lines ~438-440).
- Once authenticated, `runSubscribeFlow()` executes the runtime chain documented in the "Request Contract" section below.

Canonical examples (frontend Subscribe button):

- Minimal (landing -> Starter):

  ```
  https://app.olon.it/dashboard?intent=subscribe&plan=starter
  ```

- With explicit tracing (recommended: same `correlationId` flows through licensing APIs and the LS webhook):

  ```
  https://app.olon.it/dashboard?intent=subscribe&plan=starter&source=cloud&correlation_id=<uuid-v4>
  ```

- Upgrade of an existing tenant:

  ```
  https://app.olon.it/dashboard?intent=subscribe&plan=pro&tenant_id=<tenant-uuid>&source=cloud
  ```

Note: the dashboard host (e.g. `app.olon.it`) is environment-specific and is not hardcoded in the codebase; only the `/dashboard?intent=subscribe&plan=...` path contract is stable.

## Request Contract

- Runtime chain:
  1. `GET /api/v1/licensing/bridge-status`
  2. `POST /api/v1/licensing/create-checkout`
  3. LS overlay payment + redirect
  4. `POST /api/v1/webhooks/ls` (external)
  5. `GET /api/v1/licensing/checkout-status` polling
  6. `GET /api/v1/licensing/pending-entitlements` (FIFO selection)
  7. `POST /api/v1/tenants/provision-stream` with optional entitlement ids

## State Machine Effects

- `billing_intents` principal states:
  - `authenticated`
  - `bridge_missing` / `bridge_ready`
  - `checkout_created` / `payment_pending`
  - `licensed_ready_unassigned` / `licensed_ready_assigned`
- Transition highlights:
  - checkout created only after valid bridge context
  - webhook success transitions to licensed states
  - provision stream atomically binds unassigned entitlement to new tenant
- No-regression rules:
  - stale checkout recovery in `checkout-status` degrades to `bridge_ready`
  - webhook never regresses licensed states to pending
  - entitlement consumption rejects concurrent duplicate claims (`ERR_ENTITLEMENT_CONSUME_CONFLICT`)

## External Dependencies

- LemonSqueezy:
  - checkout generation
  - webhook event delivery/signature
- Supabase:
  - `billing_intents`, `billing_webhook_events`, `tenants`
- GitHub App + Vercel for provisioning execution

## Response Contract

- User-visible readiness signals:
  - `checkout-status.state`
  - pending entitlements list with `correlationId` + `updatedAt`
  - provision-stream SSE `done/error`
- Cross-endpoint error taxonomy:
  - checkout creation/config errors (`ERR_LS_*`, tenant/install validation)
  - webhook signature/persist errors
  - provisioning GitHub/Vercel/DB errors
  - entitlement conflict (`ERR_ENTITLEMENT_CONSUME_CONFLICT`)

## Observability

- Mandatory correlation/trace fields across flow:
  - `correlationId`
  - `eventKey` (licensing/webhook)
  - `tenantId`, `planCode`, `reason`
- Operational visibility in UI:
  - selected pending entitlement `updatedAt`
  - selected pending entitlement `correlationId`

## Failure Modes & Recovery

- Stale checkout URL/state:
  - detected by `checkout-status`, flow recovers to `bridge_ready`, create new checkout
- Missing webhook finalization:
  - status remains pre-license; operator checks webhook delivery + Vercel logs
- Entitlement consumed elsewhere:
  - provision stream emits conflict; client reloads pending list and applies FIFO next entitlement
- Stream interruption:
  - client parser flushes buffered events and surfaces structured code

## Verification Gates

- End-to-end happy path:
  - subscribe -> paid webhook -> pending/unassigned or assigned -> provision done
- Multi-pending scenario:
  - FIFO selection deterministic by `updatedAt ASC`
- Conflict path:
  - parallel consume returns `ERR_ENTITLEMENT_CONSUME_CONFLICT` and recovery picks next entitlement
- Anti-regression:
  - licensed intent not downgraded by subsequent webhook or stale client poll

