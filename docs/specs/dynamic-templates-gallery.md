# Spec: Dynamic templates gallery

Implements: [ADR-0003](../decisions/ADR-0003-olonjs-templates-gallery.md).

## Objective

Replace the hardcoded `jsonpages/tenant-radice` reference in the
"Da template" tab of the tenant-create flow with a dynamic gallery of
template repositories from `github.com/olonjs`. The user picks a template
visually (card with social preview + name + description + "Vedi demo"
link), names the new repo, and the backend provisions a tenant by cloning
the selected template.

Target users: every authenticated user that reaches Step 2 of `CreateTenantFlow`
with intent to start from a template (as opposed to importing an existing repo).

## Scope

In:

- New endpoint `GET /api/v1/templates` listing OlonJS template repos.
- New gallery UI inside the "Da template" tab of `StepRepo`
  (`src/app/dashboard/components/CreateTenantFlow.tsx`).
- Backend contract change: provisioning accepts
  `source.templateRepo = { owner, repo }` and uses it instead of constants.
- Removal of `TEMPLATE_OWNER` / `TEMPLATE_REPO` constants from
  `tenants/create/route.ts` and `tenants/provision-stream/route.ts`.
- Static social-preview rendered from `opengraph.githubassets.com`.
- "Vedi demo" CTA on each card linking to the template's `homepage`.
- In-memory cache of the templates list (TTL 5 min).

Out:

- Migration / cloning of `jsonpages/tenant-radice` — it is deprecated.
- Multi-org support (single `olonjs` constant for v1).
- Topic/whitelist filtering (relies on `is_template` only).
- Live screenshot of the deployed `homepage` (rejected at spec time;
  may return if static preview proves insufficient).
- Telemetry on template choice.
- Changes to "Da repository esistente" tab.

## Backend contract

### New endpoint

```
GET /api/v1/templates

200 OK
{
  "templates": [
    {
      "owner": "olonjs",
      "repo": "LightAlpine",
      "description": "Alpine theme — minimal landing",
      "defaultBranch": "main",
      "homepage": "https://alpine.olon.it",
      "previewUrl": "https://opengraph.githubassets.com/<sha>/olonjs/LightAlpine"
    }
  ]
}

503 Service Unavailable
{ "error": "github_unreachable", "message": "..." }
```

Notes:

- `owner` is always `olonjs` in v1 but stays in the payload so the client
  forwards `{owner, repo}` opaquely to the SSE.
- `homepage` is the value of the GitHub repo's `homepage` field. Surfaced
  to the client as the target of the "Vedi demo" link on each card.
- `<sha>` in `previewUrl` is the default-branch HEAD SHA. Used as a cache
  buster so the preview refreshes when the template is updated.
- The endpoint authenticates via the GitHub App installation on the
  `olonjs` org (server-side credential, no per-user token).
- Filters: `is_template === true`, `archived === false`, `private === false`.
- Sort: alphabetical by `repo`.

### Modified SSE payload

`POST /api/v1/tenants/provision-stream` currently accepts:

```
source: { type: "template", slug, ownerLogin, accountType }
```

Becomes:

```
source: {
  type: "template",
  slug,
  ownerLogin,
  accountType,
  templateRepo: { owner: "olonjs", repo: string }   // NEW, REQUIRED
}
```

Server-side validation:

- `templateRepo.owner === "olonjs"` (constant, hardcoded server-side).
  Any other owner → `400 ERR_INVALID_TEMPLATE_OWNER`.
- `templateRepo.repo` must exist on GitHub and have `is_template === true`.
  Otherwise → `400 ERR_TEMPLATE_NOT_FOUND`.

`tenants/create/route.ts` follows the same contract (legacy path).

## Frontend changes

File: `src/app/dashboard/components/CreateTenantFlow.tsx`, function `StepRepo`,
branch `mode === "create"`.

### New UI shape

- Replace the current static `<p>Copia da template ...</p>` block with a
  vertical layout:
  1. Gallery grid (2 columns, ~3 rows max-height with scroll if more).
     Each card contains:
     - Cover image (the `previewUrl` social preview).
     - Repo name (bold).
     - Description (1 line, truncated).
     - "Vedi demo" link (icon `ExternalLink`) opening `homepage` in a new
       tab. Click on the link does NOT select the card
       (`event.stopPropagation()`).
     Selected card has the same `border-primary bg-primary/10` treatment
     used elsewhere in the file for selection.
  2. Existing "Nome repo" input, unchanged.
  3. Existing "Verrà creato: owner/slug" hint, unchanged.

### States

- **Loading:** show 4 skeleton cards (animated `bg-elevated` pulse).
- **Empty:** "Nessun template disponibile. Riprova tra qualche minuto."
  with a manual retry button.
- **Error:** "Impossibile caricare i template (GitHub non raggiungibile)."
  with a retry button. Do **not** fall back to hardcoded values.
- **Success:** gallery as described.

### Selection

- `canProceed` in create mode becomes:
  `selectedTemplate !== null && createSlug.trim().length > 0`.
  (Today: just `createSlug.trim().length > 0`.)
- `onNext` payload in create mode includes the selected `templateRepo`.

### Data fetching

- `fetch('/api/v1/templates')` on first mount of `StepRepo`, regardless of
  the active tab — so switching to "Da template" is instant after the first
  load.
- No re-fetch on tab switch. Stale data is acceptable for the lifespan of
  the modal.

## Server-side cache

- `unstable_cache` (Next.js) wraps the GitHub call.
- Key: `["olonjs-templates"]`.
- `revalidate: 300` (5 minutes).
- `tags: ["templates"]` so the cache can be invalidated manually if needed
  later. No invalidation triggers wired in v1.
- Cache miss path performs the full GitHub call (`octokit.repos.listForOrg`
  + per-repo `defaultBranch` SHA lookup if not in the list response).

## Invariants

- Every OlonJS repo with `is_template === true` is shown to every user.
  Not-yet-public templates must not carry the flag.
- A template's social preview is *its* responsibility. The platform
  renders whatever GitHub returns for
  `opengraph.githubassets.com/<sha>/olonjs/<repo>`. If the maintainer has
  not uploaded a custom social preview, GitHub's generic card is rendered
  — accepted as good enough for v1.
- A template's `homepage` field is product-visible. It must resolve to a
  usable, branded demo — not a 404.
- `templateRepo.owner === "olonjs"` is the only org accepted by the backend.
  Multi-org requires an ADR amendment.

## Success criteria

- [ ] `GET /api/v1/templates` returns at least 1 template (assuming
      `olonjs` has one public `is_template` repo at deploy time).
- [ ] Opening the "Da template" tab on a slow connection shows skeleton
      cards within 100 ms (no blocking on GitHub).
- [ ] Selecting a card visually highlights it; clicking another card moves
      the selection.
- [ ] Clicking "Vedi demo" on a card opens `homepage` in a new tab and
      does not change the selected card.
- [ ] The "Provisiona tenant" button is disabled until a template is
      selected AND a repo name is typed.
- [ ] A provisioned tenant clones the *selected* template, not
      `jsonpages/tenant-radice`. Confirmed via the new repo's
      `parent.full_name` on GitHub.
- [ ] If GitHub returns 0 templates, the gallery shows the empty state
      with retry. Provisioning is blocked.
- [ ] If `/api/v1/templates` errors, the gallery shows the error state
      with retry. No silent fallback.
- [ ] The constants `TEMPLATE_OWNER` and `TEMPLATE_REPO` are removed from
      both route files.

## Testing strategy

- Unit: `templates` endpoint handler — mock Octokit, assert filtering
  (`is_template`, `archived`, `private`) and shape of the response.
- Unit: cache wrapper — assert single GitHub call across 5 sequential
  invocations within the TTL window.
- Component: `StepRepo` create-mode renders the four states correctly
  (loading / empty / error / populated). Use React Testing Library; mock
  `fetch`. Assert that the "Vedi demo" link click does not trigger
  card selection.
- E2E (smoke): "Da template" → pick template → fill name → provision →
  assert the resulting repo's `parent.full_name` matches the selection.

## Boundaries

Always do:

- Validate `templateRepo.owner === "olonjs"` server-side before any
  GitHub call.
- Use the GitHub App installation token; never a user token, for the
  catalogue read.

Ask first:

- Adding a second source org (requires ADR amendment).
- Switching to live screenshots (Microlink / Urlbox / Playwright) —
  ADR-0003 has a "Follow-ups" entry for this; revisit there.
- Persisting cache to Vercel KV/Blob.

Never do:

- Fall back to a hardcoded template on GitHub error. The empty/error
  state is the right user feedback.
- Accept an arbitrary `templateRepo.owner` from the client.
- Filter templates by anything other than `is_template === true` without
  amending the ADR.
