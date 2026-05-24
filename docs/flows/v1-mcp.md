# MCP Gateway (`/api/v1/mcp`)

## Purpose
Esporre endpoint MCP remoto tenant-scoped, autenticato via bearer token OAuth, con tool read/write.

## Trigger / Caller
- Claude custom connector remoto (`Remote MCP server URL`).
- Altri client MCP compatibili JSON-RPC POST.

## Request Contract
- `GET /api/v1/mcp`
  - Health/info response.
- `POST /api/v1/mcp`
  - Header auth:
    - `Authorization: Bearer <access_token>`
  - JSON-RPC methods supportati:
    - `initialize`
    - `tools/list`
    - `tools/call` (`read-content`, `hot-save`, `cold-save`, `navigate-to-page`, `update-section`, `submit-form`)
    - `notifications/*` — accepted and silently acknowledged with HTTP 202 (no JSON-RPC response). Covers the mandatory `notifications/initialized` that MCP clients send right after `initialize`, plus `notifications/cancelled`, `notifications/progress`, and any future client-originated notification.

## State Machine Effects
- Auth:
  - risolve `access_token` OAuth (`/token`) -> tenant/scopes.
  - supporta fallback legacy secret-based per compat.
- Tool `read-content`:
  - legge `tenant_content_store` (pagina + siteConfig),
  - fetch autoritativo del contract pubblico (`GET {tenantBaseUrl}/schemas/{slug}.schema.json`, stessa cache TTL del flusso `submit-form`) per allegare `schemaBaseUrl`, `sectionSchemas`, `sectionSubmissionSchemas` (entrambi keyed by section type),
  - se la discovery fallisce (tenant unreachable, contract non pubblicato/invalid, no base URL) ritorna JSON-RPC error `-32030` con `data.code` in `{ERR_TENANT_BASE_URL_MISSING, ERR_SCHEMA_FETCH_FAILED, ERR_SCHEMA_INVALID}`. read-content non degrada: o è autoritativo o è errore.
- Tool `hot-save`:
  - inoltra verso `POST /api/v1/hotSave` con `tenants.api_key` del tenant risolto.
- Tool `cold-save`:
  - legge `tenant_content_store` (`readTenantContent`), mappa file repo (`tenantContentPayloadToRepoFiles`),
  - inoltra verso `POST /api/v1/save-stream` con `files[]` (+ `message` opzionale) e `tenants.api_key`,
  - consuma stream SSE e ritorna payload terminale `done`/`error`.
  - store vuoto o mapping senza file -> `-32011` con `data.code = ERR_STORE_EMPTY`.
- Tool `navigate-to-page`:
  - acknowledge stateless dello slug target (aiuta il flusso agente).
- Tool `update-section`:
  - legge pagina dal content store,
  - sostituisce payload `data` della section per `sectionId`,
  - persiste via `hotSave` (`type: page`).
- Tool `submit-form` (ADR-0001):
  - legge pagina dal content store, risolve section per `sectionId`,
  - recupera `sectionSubmissionSchemas[sectionType]` dal contract pubblico del tenant (`GET {tenantBaseUrl}/schemas/{slug}.schema.json`, cached in-process — TTL `MCP_SUBMIT_FORM_SCHEMA_TTL_MS`, default 60s),
  - valida `data` contro lo JSON Schema via Ajv (`Ajv2020`, `allErrors`, no coercion, no default-mutation),
  - inoltra a `POST /api/v1/forms/submit` usando `tenants.api_key` + `recipientEmail` risolto dal section config,
  - aggiunge `_meta.submittedViaMcp=true`, `_meta.credentialId`, `_meta.tenantId`, `_meta.slug`, `_meta.sectionId`, `_meta.sectionType`, `_meta.schemaBaseUrl`, `_meta.correlationId` al payload forwarded.

## External Dependencies
- Supabase table `tenant_agent_credentials`.
- Supabase table `tenants`.
- `tenantContentStore` per read.
- `/api/v1/hotSave` per write.
- `/api/v1/forms/submit` per `submit-form`.
- Tenant public URL (`vercel_public_url` / custom domain) per fetch dello schema contract.

## Response Contract
- JSON-RPC envelope:
  - success: `{ jsonrpc: "2.0", id, result }`
  - error: `{ jsonrpc: "2.0", id, error: { code, message, data? } }`
- `read-content` result always carries, in addition to raw content:
  - `schemaBaseUrl` — resolved tenant base URL used for discovery (telemetry).
  - `sectionSchemas` — editable shapes keyed by section type. Plan `update-section` against `sectionSchemas[sectionType]`.
  - `sectionSubmissionSchemas` — submission shapes keyed by section type. Plan `submit-form` against `sectionSubmissionSchemas[sectionType]`.
  - On failure, no success payload: JSON-RPC `-32030` with `data.code` identifying the root cause.
- `tools/list` entries carry MCP `annotations` to drive client UX categorization. Annotations are advisory only — gateway behavior is never inferred from them:
  - `title` (display name).
  - `readOnlyHint: true` for `whoami`, `read-content`, `navigate-to-page`.
  - `destructiveHint: true` for `hot-save`, `cold-save`, `update-section`, `submit-form` (side effects on tenant content or outbound email).
  - `openWorldHint: true` for `cold-save` (git push + deploy) and `submit-form` (outbound email via tenant pipeline).
  - `idempotentHint: true` for read-only tools; explicitly `false` for save / update / submit tools (re-submissions produce duplicate writes or duplicate emails).
  - Tool `description` strings are written in human-first, action-oriented voice to maximize usability when a client (e.g. Claude) surfaces them in the connector UI.
- Error principali:
  - auth invalid -> `-32001` (HTTP 401)
  - scope mancante -> `-32003` (HTTP 403)
  - tool sconosciuto -> `-32601`
  - request invalida -> `-32600`
  - params invalidi / payload non conforme a submission schema -> `-32602` (HTTP 400). Ajv errors in `data.validationErrors`. Ulteriore `data.code = ERR_SUBMISSION_VALIDATION_FAILED` per distinguere la validazione submit-form dal generico invalid-params.
  - schema contract non raggiungibile / invalido / tenant senza base URL -> `-32030` (HTTP 409/502). `data.code` in `{ERR_TENANT_BASE_URL_MISSING, ERR_SCHEMA_FETCH_FAILED, ERR_SCHEMA_INVALID}`.
  - section type senza submission schema dichiarato -> `-32033 ERR_SECTION_SCHEMA_NOT_DECLARED` (HTTP 409).
  - downstream `/api/v1/forms/submit` non ok -> `-32012` (HTTP 502). Payload downstream in `data.payload`.

## Observability
- Correlation ID da `X-Correlation-Id` (o generato).
- `hotSave` propagate correlation verso route write.
- `submit-form` propaga correlation a `/api/v1/forms/submit`.

## Failure Modes & Recovery
- Access token invalido/scaduto (o secret legacy revocato) -> Unauthorized.
- Scope write assente -> Forbidden.
- hotSave downstream non ok -> errore JSON-RPC con payload provider.
- coldSave downstream non ok -> errore JSON-RPC con payload provider.
- `sectionId` assente o non trovato -> errore dedicato.
- `submit-form`: schema pubblico del tenant non raggiungibile -> `-32030`. Section type senza submission schema -> `-32033`. Payload non conforme -> `-32602` con Ajv errors. Downstream `/api/v1/forms/submit` non-ok (rate limit incluso) -> `-32012`.

## Verification Gates
- Token valido consente `initialize` + `tools/list`.
- Scope `read` permette `read-content` e `navigate-to-page`, ma blocca tool write e submit.
- Scope `write` consente `hot-save`, `cold-save` e `update-section`.
- Scope `submit-form` (ADR-0001) consente `submit-form`. Non implicato da `write`. Opt-in per-credenziale.
- Credenziale revocata non autentica piu.

## Tools — `submit-form` (ADR-0001)

- **Status**: implemented. See `docs/decisions/ADR-0001-mcp-submit-form-tool.md` for rationale and alternatives.
- **Input schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "slug":      { "type": "string", "description": "Page slug hosting the form. Default: home." },
      "sectionId": { "type": "string", "description": "Concrete section instance id to submit against." },
      "data":      { "type": "object", "description": "Payload validated against sectionSubmissionSchemas[sectionType] from the tenant contract." }
    },
    "required": ["sectionId", "data"],
    "additionalProperties": false
  }
  ```
- **Discovery**: agent calls `read-content` to obtain the page, then fetches the page contract at `{tenantBaseUrl}/schemas/{slug}.schema.json` to read `sectionSubmissionSchemas[sectionType]` and learn the shape of `data`. See `npm-jpcore` ADR-0002 for the tenant-side convention.
- **Authorization**: requires scope `submit-form` (new). Not covered by `write`.
- **Recipient resolution**: `recipientEmail` is read from the section's persisted config in the content store and forwarded to `/api/v1/forms/submit`. Any `recipientEmail` field present inside the agent-supplied `data` is stripped before forwarding.
- **Metadata injection**: gateway adds `_meta.submittedViaMcp = true` and `_meta.credentialId` to the forwarded body for downstream auditability.
