# Spec: A2A Agent Card — Tenant Discoverability & Public A2A Endpoint

## Objective

Enable every JsonPages tenant to be discoverable and interactable by autonomous AI agents (Google ADK, Gemini, etc.) via the A2A protocol, without requiring the tenant owner to configure anything.

**Two deliverables:**
1. **`/.well-known/agent-card.json`** — served from the tenant's custom domain, backed by Vercel Blob, generated at provision time and on content updates.
2. **`/api/v1/a2a/t/[tenantSlug]`** — a public, no-auth endpoint on the platform that exposes two tools: `read-site` and `submit-form`.

**Who benefits:** External autonomous agents (ADK, Gemini, ChatGPT agents) that crawl `/.well-known/agent-card.json` to discover what a site can do and how to interact with it. The tenant owner gets automatic A2A discoverability for free at provision time — zero configuration.

**Success looks like:** An ADK agent can point at `miotenant.com`, discover `/.well-known/agent-card.json`, read the site content, and submit a form — all without OAuth credentials or any owner setup.

---

## Architecture

```
External Agent (ADK/Gemini)
  │
  ├─► GET miotenant.com/.well-known/agent-card.json
  │     └─ Vercel rewrite → Blob: tenants/{slug}/.well-known/agent-card.json
  │
  └─► POST https://app.olon.it/api/v1/a2a/t/{tenantSlug}
        ├─ tools/list    → [read-site, submit-form]
        ├─ read-site     → delegates to existing read-content logic (no auth)
        └─ submit-form   → delegates to existing executeFormsSubmit() (no auth)

All three paths (MCP authed, A2A public, internal) share the same underlying tools.
```

---

## Piece 1: agent-card.json — Generation & Blob Upload

### Where it's generated

`src/lib/tenantStaticFiles.ts` — alongside existing static file generators
(`buildRobotsTxt`, `buildSitemapXml`, `buildLlmsTxt`).

New function: `buildAgentCard(siteConfig, tenantSlug, platformUrl)`

### Blob path

```
tenants/{tenantSlug}/.well-known/agent-card.json
```

Content-type: `application/json`, `cacheControlMaxAge: 0`, `access: "public"`.

### agent-card.json schema (A2A spec)

```json
{
  "name": "{siteConfig.title}",
  "description": "{siteConfig.description}",
  "url": "{JSONPAGES_CLOUD_URL}/a2a/t/{tenantSlug}",
  "version": "1.0",
  "capabilities": { "streaming": false },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "read-site",
      "name": "Read site content",
      "description": "Read pages, sections and schemas."
    },
    {
      "id": "submit-form",
      "name": "Submit a form",
      "description": "Submit contact, booking, or inquiry forms."
    }
  ],
  "authentication": {
    "schemes": ["OAuth2"],
    "oauth2": {
      "authorizationUrl": "{JSONPAGES_CLOUD_URL}/authorize",
      "tokenUrl": "{JSONPAGES_CLOUD_URL}/token",
      "scopes": {
        "read": "Read site content",
        "submit-form": "Submit forms on behalf of visitors"
      }
    }
  }
}
```

> The `authentication` block describes the *optional* OAuth upgrade path via the
> existing MCP credentials system. The public A2A endpoint itself requires no auth.

### When it's generated

1. **At provision** — in `provision-stream/route.ts`, after static files are generated (post-bootstrap, so `siteConfig` is available).
2. **On hot-save** — `hotSave/route.ts` calls `generateTenantStaticFiles()` which already regenerates all statics — agent-card.json is included automatically.

### vercel.json rewrite

Added to the template in `provision-stream/route.ts` alongside existing rewrites:

```json
{ "source": "/.well-known/agent-card.json", "destination": "$BLOB_BASE/tenants/$slug/.well-known/agent-card.json" }
```

**Placement:** Before the catch-all `/(.*) → /index.html` rewrite.

---

## Piece 2: Public A2A Endpoint — `/api/v1/a2a/t/[tenantSlug]`

### File

`src/app/api/v1/a2a/t/[tenant]/route.ts`

### Protocol

JSON-RPC 2.0, same structure as the existing MCP gateway.

### Auth

**None.** No Bearer token, no API key. Public endpoint.

### Tools exposed

| Tool | Description | Delegates to |
|------|-------------|--------------|
| `read-site` | Read all pages, sections, schemas | `executeReadContent()` in `mcpGatewayHandler.ts` |
| `submit-form` | Submit a form by slug + sectionId | `executeFormsSubmit()` in `mcpGatewayHandler.ts` |

**Not exposed:** `hot-save`, `cold-save`, `update-section`, `whoami` — write operations require auth via the full MCP gateway.

### CORS

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS, GET
Access-Control-Allow-Headers: Content-Type, X-Correlation-Id
```

### Error codes

Same as MCP gateway: `-32601` unknown method, `-32602` invalid params, `-32010/-32011/-32012` tool failures.

### Tenant resolution

Look up tenant by slug using existing pattern. Return 404 JSON-RPC error if not found.

---

## Code Review Findings

### What's solid

- `tenantStaticFiles.ts` is cleanly structured — `buildAgentCard()` is a natural extension of the existing pattern.
- `generateTenantStaticFiles()` returns a `StaticFile[]` array — adding agent-card.json is one more entry, no structural change.
- The existing `executeReadContent()` and `executeFormsSubmit()` in `mcpGatewayHandler.ts` are decoupled from auth — can be called directly from the public A2A route without modification.
- vercel.json rewrite pattern is already proven for `.well-known` adjacent paths (robots.txt, llms.txt, schemas).
- Hot-save already regenerates all statics — agent-card.json will stay in sync with `siteConfig` changes automatically.

### What needs attention

1. **`.well-known/` in blob path** — Current blob paths don't use dot-prefixed directories. Vercel Blob is object storage so it should handle this fine, but needs a smoke test before assuming.

2. **`agent-card.json`** — confirmed. Path: `/.well-known/agent-card.json`.

3. **`siteConfig` at provision time** — `buildAgentCard()` needs `siteConfig.title` and `siteConfig.description`. At provision, `siteConfig` is loaded during the bootstrap step. Agent-card generation must happen *after* bootstrap — add a null-safe fallback to tenant slug if siteConfig is unavailable.

4. **JSON-RPC boilerplate duplication** — The MCP gateway has auth logic coupled to tool dispatch. Rather than copy-pasting JSON-RPC parsing into the A2A route, extract a `dispatchMcpTool(tool, params, context)` helper from `mcpGatewayHandler.ts`. The A2A route passes a synthetic no-auth context; the MCP route passes the real auth context.

5. **Rate limiting** — The public endpoint has no rate limiting. Not a blocker for MVP, but needs a ticket.

---

## Tasks

- [ ] **T1** — Add `buildAgentCard()` to `src/lib/tenantStaticFiles.ts`
  - Acceptance: returns valid A2A agent-card.json for given siteConfig + slug; `url`/`authorizationUrl`/`tokenUrl` built from `process.env.JSONPAGES_CLOUD_URL`
  - Verify: unit test with mock siteConfig
  - Files: `src/lib/tenantStaticFiles.ts`

- [ ] **T2** — Add agent-card.json to `generateTenantStaticFiles()` output
  - Acceptance: included in `StaticFile[]` with path `tenants/{slug}/.well-known/agent-card.json`, correct content-type
  - Verify: existing static file tests still pass; new entry present in output array
  - Files: `src/lib/tenantStaticFiles.ts`

- [ ] **T3** — Add vercel.json rewrite in `provision-stream/route.ts`
  - Acceptance: `/.well-known/agent-card.json` rewrite present in generated vercel.json, before catch-all
  - Verify: read generated vercel.json from provision output
  - Files: `src/app/api/v1/tenants/provision-stream/route.ts`

- [ ] **T4** — Extract `dispatchMcpTool()` from `mcpGatewayHandler.ts`
  - Acceptance: MCP gateway behavior unchanged; new helper accepts optional tenant context
  - Verify: all existing MCP gateway tests pass
  - Files: `src/lib/mcpGatewayHandler.ts`

- [ ] **T5** — Create `src/app/api/v1/a2a/t/[tenant]/route.ts`
  - Acceptance: `tools/list` → `[read-site, submit-form]`; `read-site` returns content; `submit-form` submits; no auth required
  - Verify: `curl -X POST .../api/v1/a2a/t/{slug} -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'` returns correct list
  - Files: `src/app/api/v1/a2a/t/[tenant]/route.ts` (new)

---

## Boundaries

- **Always:** Generate agent-card.json at provision (post-bootstrap) and on every hot-save
- **Ask first:** Adding more tools to the public endpoint; enabling streaming; serving agent.json from tenant domain directly (not via rewrite)
- **Never:** Expose `hot-save`, `cold-save`, or `update-section` on the public no-auth endpoint

---

## Open Questions

1. **Rate limiting** — quando va sul public endpoint? Non è MVP, serve un ticket.
