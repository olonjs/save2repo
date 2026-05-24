# ADR-0002: Vercel API is the source of truth for tenant deployment and public URLs

## Status

Proposed

## Date

2026-04-21

## Context

`tenants.vercel_url` and `tenants.vercel_public_url` identify each tenant's
Vercel deployment. They are consumed by:

- Dashboard "Overview" panel (clickable links to the live site and to the
  last deployment).
- `refreshTenantPreview` / Playwright (target URL for the screenshot capture
  used as tenant preview image).
- `resolveTenantUrl` and related helpers used by several flows (save,
  cold_save, provision-stream, preview bootstrap).

The current implementation has three interrelated defects.

### 1. `vercel_url` is populated with the public alias, not the per-deployment URL

`toCanonicalLiveUrl(deployment, projectName)` in
`src/lib/saveRepoCommitDeploy.ts` and `src/app/api/v1/save-stream/route.ts`
reads `deployment.alias[0]` and falls back to `${projectName}.vercel.app`.
It never uses `deployment.url`, which is the per-deployment immutable URL
with hash (e.g. `santamamma26-6jav5bda4-jsonpages.vercel.app`). The same
value therefore ends up in both `vercel_url` and `vercel_public_url`, and
the dashboard shows identical "Deployment URL" and "Public URL" (observed
on santamamma26, 2026-04-21).

The header comment of `src/lib/vercelUrls.ts` already documents the
intended semantics:

> - Deployment URL: per-deployment immutable URL with hash.
> - Public URL: stable alias that always points to the latest production
>   deployment.

So the bug is not in the contract — it is in the writer.

### 2. First-provision race: alias-not-propagated falls back to the per-hash URL

`src/app/api/v1/tenants/provision-stream/route.ts` line 166:

```ts
if (state === 'READY') {
  const url = latest.alias?.[0] ?? latest.url ?? null;
  ...
}
```

Vercel's Deployments API is eventually consistent between the
`state = READY` transition and the population of `alias[]`. During a brief
window on very first provision, `alias` is empty while the build is already
`READY`; the loop exits and returns `latest.url` (the per-hash URL).

### 3. Per-hash URLs hit Vercel Deployment Protection, Playwright screenshots the login page

When Vercel Deployment Protection (Vercel Authentication / SSO / password)
is enabled on the tenant project, per-hash URLs return the Vercel login
wall. The public alias is exempt. Because of defect (2), Playwright is
sometimes handed the per-hash URL and captures a screenshot of the Vercel
login wall instead of the tenant site.

`capturePreviewImageBytes` sets an `x-vercel-protection-bypass` header only
if `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` is set, and Vercel's
"Protection Bypass for Automation" token is issued **per project**, so a
single platform-level env var cannot cover N tenant projects.

### 4. String-concatenated public URLs diverge from reality

`derivePublicVercelUrl(projectName)` assumes the stable public alias is
always `https://${projectName}.vercel.app`. This is usually correct but
not guaranteed: team scope suffixes, renames, and future alias overrides
can make the derived value diverge from what Vercel actually serves.

## Decision

Vercel's API is the single source of truth for both URLs.

- `tenants.vercel_url` = `toPublicUrl(deployment.url)` — the per-deployment
  immutable URL as returned by the Vercel Deployments API.
- `tenants.vercel_public_url` = `toPublicUrl(deployment.alias[0])` — the
  stable alias as returned by the Vercel Deployments API.

Neither value is ever derived from the project name via string
concatenation. `derivePublicVercelUrl(projectName)` is deprecated; the
helper may remain temporarily for compile compatibility but is no longer
called from any SOT path.

Provisioning waits for both conditions before considering a deployment
settled:

1. `state === 'READY'`
2. `Array.isArray(alias) && typeof alias[0] === 'string' && alias[0].length > 0`

Only then it returns. The existing polling loop (`intervalMs`, total
timeout) is reused; the exit condition is tightened. The fallback onto
`deployment.url` at line 166 of `provision-stream/route.ts` is removed.

Playwright-based preview capture (`refreshTenantPreview`) targets
`tenants.vercel_public_url` (the alias), not `tenants.vercel_url` (the
per-hash URL). This both avoids the Vercel Deployment Protection login
wall and produces screenshots that survive per-deployment retention
(Vercel eventually purges old per-hash URLs; aliases stay).

## Alternatives Considered

### A. Keep deriving `${projectName}.vercel.app` and keep the alias-fallback

- Pros: zero API calls, simple.
- Cons: drifts from Vercel reality on renames / scope changes; continues
  to produce login-wall screenshots when alias is not yet propagated.
- Rejected: the simplicity is false — we are already calling the
  Deployments API anyway, we simply were discarding the right fields.

### B. Add a fixed sleep (e.g. 3s) before launching Playwright

- Pros: one-line change.
- Cons: patches the symptom, not the root cause; 3s is arbitrary and
  racy; blind sleeps hide protocol bugs.
- Rejected: by the time preview capture runs, provisioning has already
  returned — so the correct place to wait is inside provisioning, not
  upstream of Playwright.

### C. Persist a per-tenant Vercel protection bypass token and use per-hash URLs for screenshots

- Pros: enables capturing screenshots of protected deployments.
- Cons: adds a secret per tenant with operational burden; does not solve
  the alias-race (alias is still required for the dashboard Public URL);
  still fails when the token is missing/rotated.
- Rejected: the public alias is already bypass-free and stable; using it
  is strictly simpler and more durable. A per-tenant bypass token is only
  worth introducing if a future feature requires capturing protected
  preview builds — out of scope here.

### D. Do nothing

- Rejected: the Overview panel already shows the wrong value for all
  tenants, and preview captures intermittently show the Vercel login page.
  Both are user-visible defects.

## Consequences

### Easier

- Dashboard "Deployment URL" and "Public URL" carry distinct, accurate
  values straight from Vercel.
- Playwright never lands on the Vercel login wall; preview screenshots
  are always on the stable alias and are not invalidated when old
  per-hash deployments are purged.
- Future features that need the per-deployment URL (inspector links,
  commit-to-deployment mapping) already have the correct value persisted.

### Harder

- Provisioning may spend one extra poll cycle (typically ≤ `intervalMs`)
  waiting for Vercel to propagate `alias[0]`. Observed worst case in prod
  so far: under 3 seconds.
- `derivePublicVercelUrl` must be removed from SOT paths (three
  writers: `saveRepoCommitDeploy.ts`, `save-stream/route.ts`,
  `provision-stream/route.ts`). Any future writer must read from Vercel
  API instead.
- Tenants whose `vercel_url` was previously written as the public alias
  remain with the stale value until the next `cold_save` / new deploy
  rewrites them (no forced backfill in this ADR — see Follow-ups).

### New invariants

- `tenants.vercel_url` and `tenants.vercel_public_url` are never equal for
  a correctly-provisioned tenant.
- `refreshTenantPreview` callers must pass `vercel_public_url`, never
  `vercel_url`. `resolveTenantUrl` switches to returning the public
  alias; the few internal call sites that need the per-hash URL (e.g.
  future inspector link) must read `vercel_url` explicitly.
- Provisioning never returns a per-hash URL to the caller; a per-hash
  URL is only ever derived as `deployment.url` at write time, and only
  into the `vercel_url` column.

## Follow-ups

- **Backfill (optional)**: at next `cold_save` or provisioning cycle, the
  stale `vercel_url == vercel_public_url` rows will self-heal. If business
  requires an immediate rewrite, a one-shot script can refetch the latest
  deployment per tenant via Vercel Deployments API and patch both columns.
  Not included in the initial change.
- **Dashboard inspector link**: not part of this ADR. If we later want a
  "Open this deployment on Vercel" link that points to
  `https://vercel.com/<team>/<project>/<deploymentId>`, we will need to
  persist `vercel_deployment_id` (and probably `vercel_team_slug`). Tracked
  separately.
- **Per-tenant bypass token**: only if we later need to capture screenshots
  of protected preview builds. Not required by the public-alias screenshot
  path chosen here.
- **Removal of `derivePublicVercelUrl`**: after the writers stop calling it
  and a grace release confirms nothing else depends on it, delete the
  helper from `src/lib/vercelUrls.ts`.

## Decision Log

- 2026-04-21 — Initial draft. Triggered by observed defect on santamamma26:
  dashboard Overview showed identical Public URL and Deployment URL, and
  initial preview screenshots captured the Vercel login wall. Root-caused
  to (a) `toCanonicalLiveUrl` preferring `alias[0]` over `deployment.url`
  and (b) `provision-stream` falling back to `deployment.url` when
  `alias[0]` had not yet propagated.
