# ADR-0003: Dynamic templates gallery sourced from olonjs GitHub org

## Status

Proposed

## Date

2026-05-18

## Context

Today the "Da template" tab in `CreateTenantFlow` is a one-way street: the
template is hardcoded as `jsonpages/tenant-radice` both client-side (UI label
in `CreateTenantFlow.tsx`) and server-side (`TEMPLATE_OWNER` / `TEMPLATE_REPO`
constants in `tenants/create/route.ts` and `tenants/provision-stream/route.ts`).
The provisioning payload does not even accept a `templateRepo` field — the
server always falls back to the constants.

Two forces push for change:

- **Product:** the platform is meant to offer a *catalogue* of starting points
  (e-commerce, blog, portfolio, alpine). With a single hardcoded template the
  product implicitly promises choice it does not deliver.
- **Organisational:** the canonical templates org has shifted from `jsonpages`
  to `olonjs` (see `github.com/olonjs/*`). The frontend still names the old
  org, which is misleading.

Constraints in play:

- The GitHub App used for provisioning must have read access on the source
  org (today: per-installation; tomorrow: also `olonjs` for catalogue read).
- The catalogue must load fast in the modal (< 300 ms perceived) without
  hitting GitHub on every render.
- Templates already self-host a live demo (their `homepage` field — e.g.
  `alpine.olon.it` for `olonjs/LightAlpine`). No new infrastructure is
  required to show "what the template looks like deployed".
- The decision must be reversible: a future operator should be able to swap
  the source org or the filter strategy without a rewrite.

## Decision

The "Da template" tab lists `github.com/olonjs` public repositories where
GitHub's native `is_template` flag is `true`. Each template is rendered as a
card with a live screenshot of the repo's `homepage` URL and a CTA linking
to the demo. The user's selected template is passed to the provisioning
backend, which uses it as the source repo to clone (replacing the existing
`TEMPLATE_OWNER`/`TEMPLATE_REPO` constants).

Minimum surface required to make it actionable:

- Source org: `olonjs`, hardcoded as a single constant in a server module
  (one place to change, no env var until we have a second org).
- Filter: GitHub's `is_template === true`. No custom topic, no whitelist.
- Preview image: external screenshot service rendering the repo's `homepage`
  URL. Cached server-side, refreshed on a schedule.
- Backend contract: provisioning SSE accepts `source.templateRepo = { owner,
  repo }`; constants removed.

## Alternatives Considered

### Status quo (do nothing)

- Pros: zero work, zero new failure modes.
- Cons: locks the product into a single template; the `jsonpages` org name
  in the UI keeps drifting from reality.
- Rejected: blocks any second template from being usable without a code
  change.

### Catalogue filter via GitHub topic (e.g. `olonjs-template`)

- Pros: explicit opt-in, allows excluding template repos that are not yet
  ready for public consumption.
- Cons: requires discipline (every new template must be tagged), and
  duplicates information GitHub already encodes via `is_template`.
- Rejected: GitHub's `Template repository` setting is the canonical signal
  for "this repo is meant to be a starting point". Mirroring it via a topic
  is an avoidable convention.

### Server-side whitelist (env var or Supabase table)

- Pros: maximum control; easy to hide a template temporarily.
- Cons: duplicates state that already exists on GitHub; a new template ships
  only when the whitelist is updated and deployed.
- Rejected: introduces a second source of truth for "what templates exist".
  Falls back to `is_template` if we later need extra curation.

### Multi-org source (`jsonpages` + `olonjs` + …)

- Pros: zero migration cost for `jsonpages/tenant-radice`; future-proof if
  partners contribute templates.
- Cons: one more axis of configuration; the UI would need org grouping;
  rate-limit budget multiplies.
- Rejected for v1: there is no concrete second org today. If/when it
  arrives, change the constant into a list — the rest of the design
  (filter, preview, backend contract) stays.

### Static screenshots stored in the repo or in Vercel Blob

- Pros: no dependency on an external screenshot service; deterministic.
- Cons: every template must commit and refresh its own preview; visual drift
  between the demo and the screenshot is silent.
- Rejected: screenshots taken at request time from the live `homepage`
  guarantee parity between what the user sees in the gallery and what they
  will get after provisioning.

### Opengraph image (`opengraph.githubassets.com`)

- Pros: free, no extra service, available for any repo.
- Cons: generic GitHub card, not a real preview of the template; useless to
  someone choosing between "alpine" and "ecommerce".
- Rejected: the whole point of A+F (from the idea-refine session) is
  showing the *site*, not the *repo*.

## Consequences

Becomes easier:

- Publishing a new template = create a public repo in `olonjs`, toggle
  "Template repository", set the `homepage` field. No platform deploy.
- The UI now mirrors the actual catalogue. The `jsonpages` org name
  disappears from the tenant-create flow.
- Each template is its own marketing surface: the demo URL is the source of
  truth for "what does this look like".

Becomes harder:

- The GitHub App's installation on `olonjs` is now load-bearing for the
  tenant-create modal. If the app is uninstalled or the org renames, the
  gallery is empty. Surface a clear empty state.
- We depend on an external screenshot service (cost, latency, vendor risk).
  Mitigated by aggressive server-side caching (TTL >= 1h) and a static
  fallback per template.
- `jsonpages/tenant-radice` either has to be re-published in `olonjs` (with
  `is_template=true`) or it disappears from the catalogue. Either way, this
  is a one-time migration task with no code dependency.

New invariants:

- Anything in `olonjs` with `is_template=true` is offered to *every* user
  who reaches Step 2. Templates not ready for public consumption must not
  carry the flag.
- The `homepage` field of a template repo is product-visible. It must
  resolve to a usable, branded demo — not a 404.

## Follow-ups

- Migration of `jsonpages/tenant-radice` (rename, clone, or deprecate).
  Out of scope for the initial change; tracked separately.
- Choice of screenshot provider (Microlink / Urlbox / self-hosted via
  Playwright on a Vercel function). Decided at spec time.
- Empty-state and error-state UX when the gallery is empty or the GitHub
  API errors. Decided at spec time.
- Telemetry: which template is chosen, conversion rate per template.
  Tracked separately.

## Decision Log

- 2026-05-18 — Initial draft.
