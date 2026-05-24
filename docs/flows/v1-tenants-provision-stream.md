# `POST /api/v1/tenants/provision-stream`

## Purpose

Provision a tenant with SSE progress (template or repository source), integrate GitHub + Vercel + Supabase, and optionally consume one pending entitlement atomically.

## Trigger / Caller

- Primary caller: `src/app/dashboard/components/CreateTenantFlow.tsx`
- Invoked from Dopa orchestration after user chooses create/import path

## Request Contract

- Method: `POST`
- Auth: no bearer token; trusts body user context from authenticated caller flow
- Body (core):
  - `installationId`, `userId`, `source`
  - `source.type = template | repository`
  - for template: `source.slug`, `source.ownerLogin`, `source.accountType?`
  - for repository: `source.repo` payload
  - optional entitlement binding:
    - `entitlementCorrelationId`
    - `entitlementPlanCode`
- Hard validations:
  - missing `installationId/userId/source`
  - invalid template payload / slug
  - missing Vercel config

## State Machine Effects

- SSE step sequence: `repo` -> `vercel` -> `env` -> `deploy` -> `db` -> `done`
- Durante lo step `repo`, dopo la copia dei file dal template, la platform legge il `vercel.json` già presente nel repo (proveniente dal template DNA), sostituisce i placeholder `{BLOB_BASE}` → `JSONPAGES_BLOB_PUBLIC_BASE` e `{slug}` → `vercelSlug`, e committa il file risolto (vedi ADR-003). Questo avviene **prima** del trigger deploy — un solo deploy, già con i rewrites Blob corretti. Il `vercel.json` non viene mai più modificato dopo il provision.
- Creates tenant record (`tenants`) and project-level metadata
- During `db` phase, performs bootstrap write to `tenant_content_store` from repository JSON (`site.json` + `pages/*.json`) before emitting `done`
- If entitlement identifiers are present:
  - performs conditional update on `billing_intents`:
    - match `user_id + plan_code + correlation_id`
    - require `state = licensed_ready_unassigned` and `tenant_id IS NULL`
  - transition to `licensed_ready_assigned` and set `tenant_id`
  - if zero rows updated -> `ERR_ENTITLEMENT_CONSUME_CONFLICT`
- No-regression rule:
  - entitlement is consumed once; duplicate/parallel consumes are rejected

## External Dependencies

- GitHub App APIs (template creation, repo operations)
- Vercel APIs (project create/env/deploy/poll)
- Supabase (`tenants`, `billing_intents`)
- Supabase (`tenant_content_store`) for initial content bootstrap
- Environment:
  - `VERCEL_TEAM_ID`, `VERCEL_AUTH_TOKEN`, GitHub App credentials

## Response Contract

- Content type: `text/event-stream`
- SSE events:
  - `step` (id/status)
  - `log` (stepId/message)
  - `error` (message, optional `code`)
  - `done` (`tenant`, `api_key`, `deployUrl`)
- Error codes:
  - GitHub: `ERR_GITHUB_NAME_TAKEN`, `ERR_GITHUB_TEMPLATE_FORBIDDEN`, `ERR_GITHUB_FAILED`
  - Vercel: `ERR_VERCEL_LIMIT_REACHED`, `ERR_VERCEL_FAILED`, `ERR_VERCEL_ENV_FAILED`
  - DB: `ERR_SUPABASE_FAILED`
  - Entitlement: `ERR_ENTITLEMENT_CONSUME_CONFLICT`
- Bootstrap: `ERR_TENANT_BOOTSTRAP_FAILED`

## Observability

- Logs keyspace:
  - `[tenants/provision-stream]`
  - entitlement sub-events: `entitlement-claimed`, `entitlement-claim-conflict`, `entitlement-claim-error`
- Minimum operational keys:
  - `userId`, `tenantId`, `entitlementCorrelationId`, `entitlementPlanCode`

## Failure Modes & Recovery

- GitHub repo name collision -> user must choose another slug
- Vercel deploy/build failures:
  - endpoint attempts best-effort cleanup of the newly created Vercel project
  - user receives explicit guidance to review code and retry provisioning
  - project reuse is not attempted in this flow
- Vercel naming/env failures -> retry provisioning with same install context
- Entitlement consume conflict:
  - client reloads pending entitlements (FIFO next) and retries
- Content bootstrap failure:
  - stream terminates with `ERR_TENANT_BOOTSTRAP_FAILED`
  - client must retry provisioning; no terminal `done` is emitted
- Stream interruption:
  - client parses buffered SSE and surfaces specific error code

## Verification Gates

- Template and repository source paths both complete with `done`
- SSE stream emits deterministic ordered steps
- Successful entitlement bind moves row to `licensed_ready_assigned` with tenant id
- Parallel consume attempt yields `ERR_ENTITLEMENT_CONSUME_CONFLICT`
- Final tenant has persisted `vercel_url` from provider response (Vercel SOT), not from synthesized project-name URL
- `vercel_url` hostname is chosen by Vercel (often `*.vercel.app` including the **team slug**); dashboard preview capture opens this URL headless — **Deployment Protection** on the tenant project or team can block unauthenticated access (see `CONTEXT.md` / `docs/api/README.md` § preview).
- Immediate tenant content read (`GET /api/v1/content` with returned API key) returns `contentStatus: "ok"` (not `empty_namespace`)

