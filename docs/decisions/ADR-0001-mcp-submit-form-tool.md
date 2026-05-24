# ADR-0001: MCP `submit-form` tool — schema-aware form submission via gateway

## Status

Accepted

## Date

2026-04-21

## Context

OlonJS tenants expose `sectionSubmissionSchemas` in their page contract
(`/schemas/{slug}.schema.json`) per the convention established in
`npm-jpcore` ADR-0002. Each form-capable section declares the exact shape
of its submission payload (e.g. `form-demo` → `{ name, email, message }`),
and any MCP agent that `read-content`s a page can — in principle — discover
both *that* a form exists and *what fields it accepts*, without scraping
the DOM.

The missing piece is the **action side**: there is today no MCP tool that
lets an agent *submit* a form on behalf of the user. The existing HTTP
endpoint `/api/v1/forms/submit` works, but:

- It is authenticated via tenant `api_key` (Bearer), not via the OAuth
  credentials (`tenant_agent_credentials`) that the MCP gateway uses.
- It accepts arbitrary JSON bodies — no schema validation at the edge. This
  is intentional (it predates the submission-schema convention) but it
  prevents meaningful "fail fast with clear error" semantics from an MCP
  context.
- It has no concept of *which* section on *which* page the submission
  targets; the caller is expected to already know the recipient email and
  to pass it in the body.

The MCP gateway currently exposes `whoami`, `read-content`, `hot-save`,
`cold-save`, `navigate-to-page`, `update-section`. Scopes in
`tenant_agent_credentials.scopes` are the literal set `{"read","write"}`
(see `src/lib/mcpGatewayCredentials.ts`). All write-class tools require
`write`.

Target user experience (from the product brief):

> "Claude, book a room." → agent reads the page, finds no booking form,
> finds a contact form, asks the user for the fields the schema
> declares, fills them in, submits through MCP, the existing Resend flow
> fires as today.

For this to work, three contracts must line up cleanly:

1. **Discovery** — already solved by `sectionSubmissionSchemas` in the
   page contract (`npm-jpcore` ADR-0002, Slice 3).
2. **Submission** — a new MCP tool, `submit-form`, subject of this ADR.
3. **Delivery** — the existing `/api/v1/forms/submit` pipeline (leads
   persistence, Resend email, DLQ). Reused, not duplicated.

AGENTS.md ("Boundaries") requires that any new MCP tool update scope
checks via `hasScope` and document itself in `docs/flows/v1-mcp.md` and
`AgentsPanel` descriptions. This ADR commits to those follow-ups.

## Decision

Add an MCP tool `submit-form` to the gateway JSON-RPC handler
(`src/lib/mcpGatewayHandler.ts`). The tool:

1. **Accepts** a reference to a concrete form instance on a concrete page:

   ```json
   {
     "slug": "home",
     "sectionId": "form-demo-1",
     "data": { "name": "...", "email": "...", "message": "..." }
   }
   ```

   `slug` and `sectionId` are required. `data` is the submission payload.

2. **Resolves** the target section by reading the tenant's content store
   (`readTenantContent`), locating the section by `id`, and inferring
   `sectionType` and `recipientEmail` from that section's persisted config.

3. **Validates** `data` against the JSON Schema declared for
   `sectionType` in the tenant's page contract, fetched from the tenant's
   public endpoint `GET {tenantBaseUrl}/schemas/{slug}.schema.json` using
   `tenants.vercel_public_url` (preferred) or custom-domain fallback.
   Schema lookup is cached in-process with a short TTL (target: 60s).
   Invalid payload → JSON-RPC error `-32602 Invalid params` with Ajv error
   details in `data.validationErrors`.

4. **Forwards** the validated payload to the existing HTTP endpoint
   `POST /api/v1/forms/submit` using the **tenant API key**
   (`tenants.api_key`) resolved from the OAuth credential's tenant
   context — the same pattern already used by `hot-save` / `cold-save`.
   The body posted downstream is `{ ...data, recipientEmail, _meta }`
   where `recipientEmail` is **server-resolved** from the section config
   (see "Tenant convention" below). Any `recipientEmail` supplied by the
   agent in `data` is stripped before forwarding. `_meta` is injected
   by the gateway (`submittedViaMcp`, `credentialId`, `tenantId`, `slug`,
   `sectionId`, `sectionType`, `schemaBaseUrl`, `correlationId`) and
   likewise cannot be supplied by the agent.

5. **Requires** a new dedicated credential scope `submit-form`. Not
   reusing `write`, because the operational risk profile is materially
   different (see "Alternatives Considered / Reuse write scope"). The
   scope must be added to `AgentCredentialScope` and to the
   `ALLOWED_SCOPES` allowlist in `src/lib/mcpGatewayCredentials.ts`.

6. **Advertises itself** in `tools/list` with an `inputSchema` keyed on
   `slug`, `sectionId`, `data`, and documents that the concrete shape of
   `data` is discoverable via `read-content` →
   `sectionSubmissionSchemas[sectionType]`.

7. **Propagates** `X-Correlation-Id` to the downstream `/api/v1/forms/submit`
   call, preserving the existing observability contract.

The tool is additive — no existing behaviour is changed. Existing
callers of `/api/v1/forms/submit` (tenant-rendered HTML forms) continue
to function unchanged; the endpoint retains its permissive, API-key-based
contract.

## Tenant Convention — `data.recipientEmail`

To be MCP-submittable a section **MUST** expose a `recipientEmail`
field in its section-config schema (the Zod schema registered in
`SECTION_SCHEMAS`). The gateway reads the destination address from
exactly one path:

```
section.data.recipientEmail
```

Rules:

- **The field is authoritative.** If present and non-empty it is passed
  to `/api/v1/forms/submit` as the `recipientEmail` body field. The
  downstream endpoint uses it verbatim to route the Resend email.
- **The field is tenant-owned.** Only the tenant operator (page editor,
  Studio, or `hot-save`/`cold-save`) can set it. It travels with the
  page JSON.
- **The field is never agent-controlled.** Any `recipientEmail` key
  appearing in the agent's `data` argument to `submit-form` is stripped
  by the gateway before forwarding. This guarantees agents cannot
  redirect leads to arbitrary inboxes.
- **Display email ≠ recipient email.** A tenant may independently
  expose a public-facing `email` field (shown on the page for human
  visitors) and a separate `recipientEmail` for lead routing. They
  coexist without conflict; only `recipientEmail` is consumed by MCP.
- **No alternative field names are recognised.** `contactEmail`,
  `mailTo`, `email`, etc. are NOT inspected. Tenants that want to be
  MCP-submittable must conform to this exact key name.
- **If missing.** The gateway forwards without a `recipientEmail` and
  `/api/v1/forms/submit` falls back to its existing default resolution
  (or rejects, depending on the endpoint's contract). Tenants that
  never set the field remain non-MCP-submittable in practice even if
  they declare a submission schema.

This convention is mirrored on the tenant/core side by ADR-0002
(`@olonjs/core` — form submission schemas). A tenant that follows both
conventions (submission schema declared in `SECTION_SUBMISSION_SCHEMAS`
and `recipientEmail` present in section data) is automatically
MCP-submittable with no platform-side configuration.

## Alternatives Considered

### A. Reuse `write` scope instead of introducing `submit-form`

- Pros: Zero migration. No DB enum change. Simpler story for operators.
- Cons: `write` today grants content-authoring (`hot-save`, `cold-save`,
  `update-section`). Conflating it with "can send email on behalf of the
  site and create leads" is a real privilege escalation: a third-party
  agent granted "write" to help edit copy would gain the ability to flood
  the tenant's inbox or impersonate visitors at scale. The blast radius
  of the two capabilities is different; the scope should reflect that.
- Rejected: principle of least privilege. The migration cost is small
  (single enum addition, no data loss) relative to the ongoing auth
  hygiene cost of a conflated scope.

### B. Let the gateway call Resend directly, bypass `/api/v1/forms/submit`

- Pros: Simpler control flow. Fewer hops.
- Cons: Duplicates idempotency handling, rate-limiting, lead persistence,
  GitHub storage policy, DLQ, and tenant-repo email template resolution.
  Two code paths for the same business outcome ("a lead is created and
  notified") diverge inevitably.
- Rejected: `/api/v1/forms/submit` is the single source of truth for the
  lead lifecycle. The MCP tool must be a thin adapter on top of it.

### C. Agent passes the schema / recipient email in the tool call

- Pros: Gateway becomes stateless; no schema fetch, no content read.
- Cons: The agent could submit against an arbitrary claimed schema, or
  redirect emails to addresses not configured on the site. This breaks
  the "tenant controls the contract" invariant and opens trivial abuse
  vectors (e.g. reflecting messages to attacker-controlled addresses).
- Rejected: the tenant site is the schema's authoritative source. The
  gateway must re-verify.

### D. Store the submission schema in the platform content store

- Pros: No cross-origin fetch; fast, offline-safe validation.
- Cons: Requires tenant runtime to push the schema (another protocol
  step), invalidation semantics, and storage schema changes. Couples
  platform storage to a contract owned by `@olonjs/core`.
- Rejected for v1; kept in "Follow-ups" as a potential optimisation
  once access patterns are understood.

### E. No validation at the gateway; pass-through to `/api/v1/forms/submit`

- Pros: Minimal implementation.
- Cons: The headline benefit of `sectionSubmissionSchemas` is "the agent
  knows the shape *and* can get a precise error when it gets the shape
  wrong". Without gateway validation, wrong shapes become silent
  successes (a lead with `{ color: "blue" }` in `data` still fires an
  email). Moreover, agents cannot distinguish "my payload was wrong" from
  "the tenant has a problem".
- Rejected: validation at the boundary is load-bearing for the product
  claim. Downstream `/api/v1/forms/submit` keeps its permissive
  behaviour as defence in depth for non-MCP callers.

### F. Do nothing

- Pros: No work.
- Cons: Forecloses the "conversational form filling" feature and leaves
  `sectionSubmissionSchemas` as a read-only curiosity.
- Rejected.

## Consequences

### Positive

- The platform gains a principled, least-privilege surface for
  agent-driven form submission. The schema published by the tenant is
  the contract the gateway enforces.
- `/api/v1/forms/submit` remains the single path for lead lifecycle
  (persistence, idempotency, rate-limit, Resend, DLQ, audit). No
  duplication.
- The new scope enables granular operator policy: "this agent may read
  and submit forms, but not edit the site".
- Correlation IDs flow end-to-end (agent → MCP gateway → forms endpoint
  → Resend), preserving existing observability.

### Negative / new burdens

- **New scope `submit-form`** must be added to the `scopes` enum /
  allowlist and surfaced in the credential-provisioning UI
  (`AgentsPanel`). Existing credentials will not have it; tenant
  operators must grant it explicitly. Documented migration is: "re-issue
  credential with the new scope". No automatic uplift.
- **Cross-origin schema fetch** from gateway to tenant public URL
  introduces a runtime dependency on tenant deployment availability.
  Failure modes: tenant domain down, custom-domain misconfig, CDN cache
  stale. Mitigations: short TTL in-process cache, explicit JSON-RPC error
  code (`-32030 ERR_SCHEMA_UNAVAILABLE`) distinct from validation
  errors; retries are the agent's responsibility.
- **Tenant public URL resolution** already exists
  (`derivePublicVercelUrl`) but we must be explicit about precedence:
  custom domain (if verified) > `vercel_public_url` > `vercel_url`.
- **Ajv** (or equivalent JSON Schema validator) becomes a new
  dependency. Preferred: Ajv 2020 with `ajv-formats` (for `email`,
  `uri`). Bundle impact: ~120kb, server-side only — acceptable on Next.js
  server runtime.
- **Rate limiting**: `/api/v1/forms/submit` already rate-limits by
  source IP. An MCP-originated submission sends from the Vercel function
  IP (effectively one shared bucket for all MCP traffic). Follow-up:
  augment rate-limit key with `(tenant_id, credential_id)` when the
  submission is MCP-originated. Covered in "Follow-ups".
- **Lead attribution**: leads created through MCP should be
  distinguishable from leads created by a human via the tenant HTML form.
  The forwarded body will carry a reserved field
  `_meta.submittedViaMcp = true` (platform-set, not agent-supplied) and
  `_meta.credentialId`. Downstream persistence will capture it in
  `lead_events.payload`.

### Invariants the team must uphold

- The agent never sees the tenant `api_key`. The gateway is the only
  holder; it mints a short-lived forwarded request.
- The agent cannot redirect lead emails: `recipientEmail` is resolved
  server-side from `section.data.recipientEmail`. Any `recipientEmail`
  supplied by the agent in `data` is stripped before the payload is
  forwarded to `/api/v1/forms/submit`. See "Tenant Convention — `data.recipientEmail`" above.
- Schema validation happens *before* the downstream POST. No lead is
  persisted for an invalid MCP payload.

## Follow-ups

Out of scope for this ADR / the first implementation slice:

1. **Per-credential rate limit** on `/api/v1/forms/submit` when the
   submission originates from the gateway (otherwise all MCP traffic
   shares one IP bucket). Tracked separately.
2. **Content-store schema snapshot** (Alternative D) once we have
   production traffic data to justify it. Today's live fetch is the
   simpler default.
3. **Agent-side typed client** (TypeScript) generated from the ADR's
   tool schema, distributed alongside the MCP manifest.
4. **`AgentsPanel` UI** to render the new `submit-form` scope as an
   opt-in checkbox in the credential issuance flow.
5. **`docs/flows/v1-mcp.md`** update with the tool's full request /
   response / error contract — done alongside this ADR's acceptance.
6. **Extension beyond `form-demo`**: other tenant sections (booking,
   newsletter) that declare `submissionSchema` become eligible with zero
   gateway changes. Validate this with a second tenant section before
   declaring the convention stable.

## Decision Log

- 2026-04-21 — Initial draft. Open points recorded inline in
  "Alternatives Considered"; all tentatively resolved in favour of
  dedicated scope (A → rejected), thin adapter (B → rejected),
  tenant-authoritative schema (C → rejected), live fetch over snapshot
  (D → deferred), gateway-side validation (E → rejected), proceeding
  (F → rejected). Awaiting acceptance before implementation.
- 2026-04-21 — Accepted. Implementation begins in slices: (1) scope
  plumbing, (2) schema fetch+cache utility, (3) Ajv validator wrapper,
  (4) tool handler wiring in `mcpGatewayHandler.ts`. No DB migration
  required for scope addition (scopes stored as `text[]`).
- 2026-04-21 — Tenant convention made explicit: `data.recipientEmail`
  is the one and only path the gateway reads for lead destination.
  Added "Tenant Convention — `data.recipientEmail`" section. Corrected
  drift at "Decision" step 4 (agent override of `recipientEmail` never
  existed in implementation — the field is always stripped from the
  agent payload). Mirrored in ADR-0002 (core) tenant convention section.
- 2026-04-21 — Implementation landed across 4 slices. Error code mapping
  in handler: `-32030` for schema unavailable / fetch failure / invalid
  shape / missing tenant base URL (`data.code` disambiguates),
  `-32033 ERR_SECTION_SCHEMA_NOT_DECLARED` when the tenant contract has
  no submission schema for that section type, `-32602` for Ajv
  validation failure (`data.validationErrors`), `-32012` for downstream
  `/api/v1/forms/submit` failure. Ajv choice: `Ajv2020` with
  `addFormats`, `allErrors: true`, `strict: false`, no coercion, no
  default-mutation. Cache TTL configurable via
  `MCP_SUBMIT_FORM_SCHEMA_TTL_MS` (default 60_000ms), fetch timeout via
  `MCP_SUBMIT_FORM_SCHEMA_FETCH_TIMEOUT_MS` (default 5_000ms).
