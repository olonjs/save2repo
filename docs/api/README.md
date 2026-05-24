# API v1 Function Flows

Questa guida documenta i flussi funzione degli endpoint attivi in `src/app/api/v1`, con focus su:
- input e validazioni;
- modello auth/header richiesti;
- dipendenze esterne (Supabase, GitHub, Vercel, LemonSqueezy);
- output, stati e codici errore principali.

## Endpoint Inventory

### Save & Content

| Method | Endpoint | Scopo |
|---|---|---|
| `POST` | `/api/v1/save` | Salvataggio sincrono su GitHub (legacy, no deploy wait) |
| `POST` | `/api/v1/save-stream` | Salvataggio con stream SSE e deploy Vercel deterministico |
| `POST` | `/api/v1/hotSave` | Hot save su Supabase content store + dirty-state tracking |
| `POST` | `/api/v1/save2repo` | Cold sync Edge Config->Repo con SSE deploy e reset dirty-state |
| `GET` | `/api/v1/content` | Read tenant-scoped da Supabase content store (cloud-first content bootstrap) |
| `GET` | `/api/v1/mcp` | Health/info endpoint MCP gateway |
| `POST` | `/api/v1/mcp` | MCP gateway JSON-RPC tenant-scoped (tools list/call) |

### Assets

| Method | Endpoint | Scopo |
|---|---|---|
| `POST` | `/api/v1/assets/upload` | Upload immagine tenant-authenticated su Vercel Blob (public URL per contenuti) |
| `GET` | `/api/v1/assets/list` | Lista immagini Blob del tenant autenticato per Image Picker library |

### Tenants

| Method | Endpoint | Scopo |
|---|---|---|
| `POST` | `/api/v1/tenants/provision-stream` | Provisioning tenant unificato (template o repository) via SSE |
| `POST` | `/api/v1/tenants/create` | Provisioning legacy sincrono |
| `POST` | `/api/v1/tenants/previews/bootstrap` | Bootstrap immagini preview tenant per dashboard |
| `POST` | `/api/v1/tenants/:id/save2edge-snapshot` | Snapshot repo JSON -> Supabase content store (SSE) |
| `POST` | `/api/v1/tenants/:id/cold-save` | Cold save: Supabase content store -> GitHub + deploy production (SSE) |
| `DELETE` | `/api/v1/tenants/:id` | Hard delete progetto con cleanup Blob + delete cascade riferimenti DB |
| `GET` | `/api/v1/tenants/:id/agents` | Lista credenziali agent del tenant |
| `POST` | `/api/v1/tenants/:id/agents` | Crea credenziale OAuth agent (`client_id` + `client_secret` show-once) |
| `DELETE` | `/api/v1/tenants/:id/agents/:credentialId` | Revoca credenziale agent |
| `POST` | `/api/v1/tenants/:id/admin-keypair` | Genera keypair EC P-256 per-tenant; salva private key in DB, restituisce public key |
| `POST` | `/api/v1/tenants/:id/admin-token` | Emette JWT ES256 (exp 5 min) firmato con la private key del tenant per accesso `/admin` |

### Tenant Leads

| Method | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/v1/tenants/:id/leads` | Lista leads tenant con stato delivery |
| `GET` | `/api/v1/tenants/:id/leads/:leadId/events` | Timeline eventi di un lead tenant |

### Tenant Domains

| Method | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/v1/tenants/:id/domains` | Lista domini custom tenant |
| `POST` | `/api/v1/tenants/:id/domains` | Aggiunge dominio custom via Vercel |
| `GET` | `/api/v1/tenants/:id/domains/:domain` | Stato dominio (con verifica opzionale) |
| `DELETE` | `/api/v1/tenants/:id/domains/:domain` | Rimuove dominio custom |
| `POST` | `/api/v1/tenants/:id/domains/:domain/verify` | Triggera verifica dominio su Vercel |

### Licensing

| Method | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/v1/licensing/bridge-status` | Risoluzione bridge GitHub installazione per checkout licensing |
| `POST` | `/api/v1/licensing/create-checkout` | Crea o riusa checkout LemonSqueezy |
| `GET` | `/api/v1/licensing/checkout-status` | Stato checkout/licensing utente+tenant |
| `GET` | `/api/v1/licensing/pending-entitlements` | Entitlements pronti non ancora assegnati a tenant |
| `GET` | `/api/v1/licensing/subscription-summary` | Snapshot subscription per Billing tab tenant |
| `GET` | `/api/v1/licensing/portal` | Risolve link Lemon customer portal sicuro |

### GitHub

| Method | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/v1/github/installations` | Lista installazioni GitHub App |
| `GET` | `/api/v1/github/repos?installation_id=...` | Lista repository accessibili da installazione |

### Forms & Webhooks

| Method | Endpoint | Scopo |
|---|---|---|
| `POST` | `/api/v1/forms/submit` | Ingestion forms tenant con policy storage + delivery Resend |
| `POST` | `/api/v1/webhooks/ls` | Webhook LemonSqueezy con firma HMAC + idempotenza |
| `POST` | `/api/v1/webhooks/resend` | Webhook Resend con firma Svix + dedup eventi |

### Other

| Method | Endpoint | Scopo |
|---|---|---|
| `POST` | `/api/v1/link` | Link progetto esistente con license test |

### Internal (admin/cron)

| Method | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/v1/internal/domains/events` | Lista eventi dominio |
| `GET` | `/api/v1/internal/domains/dlq` | Lista DLQ domini (pending default) |
| `POST` | `/api/v1/internal/domains/dlq/:id/retry` | Retry item DLQ dominio |
| `GET` | `/api/v1/internal/domains/metrics` | Metriche domini (events, pending, stuck, DLQ) |
| `POST` | `/api/v1/internal/domains/reconcile` | Riconcilia domini pending/verifying con Vercel |
| `POST` | `/api/internal/tenant-preview/reconcile` | Riconcilia preview tenant |
| `POST` | `/api/internal/tenant-preview/refresh` | Refresh singolo preview tenant |

---

## 1) `POST /api/v1/save` (legacy sync)

### Auth
- Header: `Authorization: Bearer <api_key>`

### Input
- Body: `{ path, content, message? }`

### Flusso funzione
1. Valida header Authorization.
2. Lookup tenant su Supabase via `api_key`.
3. Verifica `github_installation_id`.
4. Legge eventuale SHA file corrente su GitHub.
5. Esegue `createOrUpdateFileContents`.
6. Ritorna JSON `success`.

### Output
- `200`: `{ success: true, message: "Saved to GitHub" }`
- Errori tipici: `401`, `403`, `400`, `500`

### Note operative
- Non attende build/deploy su Vercel.
- Validazione legacy `if (!path || !content)` (puo rigettare contenuti falsy validi).

---

## 2) `POST /api/v1/save-stream` (SSE + deploy esplicito)

### Auth
- Header: `Authorization: Bearer <api_key>`

### Input
- Body: `{ path, content, message? }`

### Eventi SSE emessi
- `step`: stato step (`commit`, `push`, `build`, `live`)
- `log`: log incrementali per step
- `error`: errore strutturato (almeno `message`, con `code`/`stepId` quando disponibili)
- `done`: payload finale `{ deployUrl, commitSha }`

### Flusso funzione
1. Autentica API key e carica tenant.
2. Verifica prerequisiti: `github_installation_id`, `vercel_project_id`, `VERCEL_TEAM_ID`, `VERCEL_AUTH_TOKEN`.
3. Commit su GitHub (create/update file JSON).
4. Legge progetto Vercel per ottenere `link.repoId`.
5. Triggera deploy esplicito (`POST /v13/deployments`) sul branch `main`.
6. Polling deterministico su `deploymentId`:
   - stato effettivo risolto con priorita `readyState` -> `state`,
   - terminali: `READY`, `ERROR`, `CANCELED`, `FAILED`,
   - timeout con errore dedicato.
7. Calcola URL canonica (alias > `projectName.vercel.app` > `deployment.url`).
8. Aggiorna `tenants.vercel_url` su Supabase.
9. Emette `done`.

### Error codes principali
- `ERR_UNAUTHORIZED`, `ERR_INVALID_API_KEY`, `ERR_BAD_REQUEST`
- `ERR_GITHUB_INSTALLATION_MISSING`, `ERR_GITHUB_COMMIT_SHA_MISSING`
- `ERR_VERCEL_PROJECT_MISSING`, `ERR_VERCEL_NOT_CONFIGURED`
- `ERR_VERCEL_PROJECT_FETCH_FAILED`, `ERR_VERCEL_REPO_LINK_MISSING`
- `ERR_VERCEL_DEPLOY_TRIGGER_FAILED`, `ERR_VERCEL_DEPLOY_TIMEOUT`, `ERR_VERCEL_DEPLOY_FAILED`
- `ERR_VERCEL_DEPLOY_URL_MISSING`, `ERR_TENANT_URL_PERSIST_FAILED`
- `ERR_SAVE_STREAM_INTERNAL`

---

## 3) `POST /api/v1/tenants/provision-stream` (primary provisioning endpoint)

### Auth
- Nessuna sessione utente server-side obbligatoria nel route handler.
- Richiede payload applicativo valido (`installationId`, `userId`, `source`).

### Input
- Body:
  - `installationId` (number)
  - `userId` (string)
  - `source.type: "template" | "repository"`
  - source-specific payload:
    - template: `slug`, `ownerLogin`, `accountType?`
    - repository: `repo` con owner/name/id
  - opzionali licensing bind: `entitlementCorrelationId`, `entitlementPlanCode` (`starter|pro|business`)

### Contratto SSE canonico
- Header response: `Content-Type: text/event-stream`
- Eventi:
  - `step`: avanzamento step (`repo`, `vercel`, `env`, `deploy`, `db`)
  - `log`: messaggi progressivi per step
  - `error`: payload completo
    - `message` (string)
    - `code` (string, default `ERR_PROVISION_STREAM`)
    - `stepId` (`repo|vercel|env|deploy|db`)
    - `provider` (`github|vercel|supabase|system`)
    - `requestId` (header `x-vercel-id`/`x-request-id` o UUID generato)
    - `providerStatus` (HTTP status provider o `null`)
  - `done`: payload finale
    - `tenant`: `{ id, slug, name, github_repo_id, github_repo_name, vercel_project_id, vercel_url, requested_name, final_project_name, naming_attempts, status }`
    - `api_key`
    - `deployUrl`

### Flusso funzione
1. Valida payload base e config Vercel.
2. Branch `source.type`:
   - `template`: crea repo da template (con fallback Git Data API),
   - `repository`: collega repo esistente.
3. Naming policy Vercel:
   - tenta nome richiesto,
   - su collisione usa suffix `-jsonNNNNN`.
4. Crea progetto Vercel.
5. Inietta env (`VITE_JSONPAGES_CLOUD_URL`, `VITE_JSONPAGES_API_KEY`).
6. Trigger primo deploy e attende `READY`.
   - Se il build/deploy fallisce: cleanup best-effort del progetto Vercel appena creato (no riuso progetto).
7. Salva tenant su Supabase con metadata naming e `vercel_url` dalla risposta Vercel (SOT provider, no URL sintetiche).
8. Se presenti `entitlementCorrelationId` + `entitlementPlanCode`, prova claim atomico entitlement.
9. Bootstrap contenuti iniziali tenant da repository (`src/data/config/site.json` + `src/data/pages/*.json`) e persistenza su `tenant_content_store`.
10. Emette `done` solo dopo bootstrap completato.

### Error codes principali
- Input: `ERR_PROVISION_INVALID_INPUT`, `ERR_TEMPLATE_INPUT_INVALID`, `ERR_TEMPLATE_SLUG_INVALID`, `ERR_REPOSITORY_PAYLOAD_MISSING`, `ERR_REPOSITORY_SOURCE_INVALID`
- GitHub: `ERR_GITHUB_NAME_TAKEN`, `ERR_GITHUB_TEMPLATE_FORBIDDEN`, `ERR_GITHUB_FAILED`
- Vercel: `ERR_VERCEL_NOT_CONFIGURED`, `ERR_VERCEL_LIMIT_REACHED`, `ERR_VERCEL_FAILED`, `ERR_VERCEL_ENV_FAILED`
  - su `ERR_VERCEL_FAILED` in fase deploy: messaggio guidato "Build failed, review your code and retry provisioning"
- DB/licensing bind: `ERR_SUPABASE_FAILED`, `ERR_ENTITLEMENT_CONSUME_CONFLICT`
- Bootstrap contenuti: `ERR_TENANT_BOOTSTRAP_FAILED`
- Catch-all: `ERR_PROVISION_STREAM_INTERNAL`

---

## 2.1) `POST /api/v1/hotSave` (hot path, beta)

### Auth
- Header: `Authorization: Bearer <api_key>`
- Header opzionali: `Idempotency-Key`, `x-correlation-id`

### Input
- Body single-entity: `{ slug, type: "page" | "config", data }`
- Body bundle: `{ slug, page, siteConfig }` (salva pagina e config in una sola chiamata)

### Flusso funzione
1. Verifica feature flags (`SAVE2ROUTES_BETA`, `SAVE_HOT_ENABLED`).
2. Resolve tenant via API key.
3. Determina modalita:
   - **bundle**: legge contenuto corrente, merge pagina e siteConfig, scrive via `replaceTenantContent`.
   - **page**: upsert singola pagina via `upsertTenantPage`.
   - **config**: upsert siteConfig via `upsertTenantSiteConfig`.
4. Aggiorna tenant state:
   - `unsynced_changes_count += 1`
   - `last_hot_save_at = now()`
   - `sync_status = "dirty"`

### Output
- `200`: `{ ok: true, correlationId, idempotencyKey, key, savedEntities, unsyncedChangesCount, savedAt }`
- `400`: `ERR_BAD_REQUEST` (slug mancante o payload invalido)
- `401`: `ERR_UNAUTHORIZED` (bearer key mancante)
- `403`: `ERR_INVALID_API_KEY`
- `500`: `ERR_HOTSAVE_STATE_UPDATE_FAILED` (write completata ma state update fallito)
- `502`: `ERR_HOTSAVE_WRITE_FAILED`
- `503`: `ERR_HOTSAVE_DISABLED` (feature flags disabilitati)

---

## 2.2) `POST /api/v1/save2repo` (cold sync, SSE, beta)

### Auth
- Header: `Authorization: Bearer <api_key>`
- Header opzionale: `x-correlation-id`

### Input
- Body opzionale: `{ message?: string }`

### Eventi SSE emessi
- `step`: (`gather`, `commit`, `build`, `live`)
- `log`: log incrementali per step
- `error`: errore strutturato (`message`, `code`, `correlationId`)
- `done`: `{ deployUrl, commitSha, syncedAt }`

### Flusso funzione
1. Verifica feature flags (`SAVE2ROUTES_BETA`, `SAVE_REPO_ENABLED`).
2. Resolve tenant e prerequisiti (`vercel_edge_config_id`, GitHub install, `vercel_project_id`).
3. Legge stato completo da Edge Config.
4. Mappa i dati hot in file JSP:
   - `page:*` -> `src/data/pages/*.json`
   - `config:site` -> `src/data/config/site.json`
5. Commit multi-file su GitHub (no `[skip ci]`).
6. Trigger deploy Vercel + polling deterministico.
7. Su successo:
   - `tenants.vercel_url` aggiornato
   - `unsynced_changes_count = 0`
   - `last_cold_sync_at = now()`
   - `sync_status = "synced"`

### Output
- `200` stream completion via `done`
- `error` event per ogni failure terminale

---

## 2.3) `GET /api/v1/content` (tenant-scoped read, beta)

### Auth
- Header: `Authorization: Bearer <api_key>`
- Header opzionale: `x-correlation-id`

### Output
- `200`: `{ ok, source, tenantId, tenantSlug, correlationId, updatedAt, contentStatus, namespace, namespaceMatchedKeys, siteConfig, pages, diagnostics }`
  - `source`: `"supabase"`
  - `contentStatus`: `"ok"` | `"empty_namespace"`
  - `siteConfig`: oggetto o `null`
  - `pages`: record slug -> page payload (chiavi normalizzate)
- `401`: `ERR_UNAUTHORIZED` (bearer key mancante)
- `403`: `ERR_INVALID_API_KEY`
- `502`: `ERR_CONTENT_READ_FAILED`
- `503`: `ERR_CONTENT_DISABLED` (feature flag disabilitato)

### Flusso funzione
1. Verifica feature flag `SAVE2ROUTES_BETA`.
2. Resolve tenant via `api_key`.
3. Legge contenuto da Supabase via `readTenantContent(tenantId)`.
4. Normalizza chiavi pagine (strip namespace prefix, lowercase).
5. Ritorna payload con diagnostics (`sourceStore`, `emptyNamespace`).

---

## 2.4) `POST /api/v1/assets/upload` (tenant media upload)

### Auth
- Header: `Authorization: Bearer <api_key>`
- Header opzionale: `x-correlation-id`

### Input
- `multipart/form-data`
  - `file` (required, `File`)
  - `filename` (optional override)

### Flusso funzione
1. Resolve `correlationId`.
2. Valida `content-type` (`multipart/form-data`).
3. Valida Bearer API key e tenant lookup su `tenants`.
4. Valida token Blob (`BLOB_READ_WRITE_TOKEN` o `JSONPAGES_READ_WRITE_TOKEN`).
5. Parse multipart, valida file:
   - presente e non vuoto
   - dimensione max (`ASSETS_MAX_UPLOAD_BYTES`, default 5MB)
   - mime type image consentito (`jpeg|png|webp|gif|avif`)
   - firma binaria coerente col mime (`magic bytes`)
6. Applica rate limit per tenant (`ASSETS_UPLOAD_RATE_LIMIT_PER_MINUTE`, default 30/min, best effort per istanza).
7. Costruisce object path tenant-scoped: `tenant-assets/<tenantId>/<timestamp>-<uuid>-<safeName>.<ext>`.
8. Upload su Vercel Blob con accesso `public`.
9. Ritorna metadata upload e URL pubblica.

### Output
- `200`: `{ ok: true, correlationId, tenantId, tenantSlug, url, pathname, contentType, size }`
- `400`: `ERR_FILE_MISSING`, `ERR_FILE_EMPTY`, `ERR_FILE_TYPE_NOT_ALLOWED`, `ERR_FILE_SIGNATURE_INVALID`
- `401`: `ERR_UNAUTHORIZED`
- `403`: `ERR_INVALID_API_KEY`
- `415`: `ERR_UNSUPPORTED_CONTENT_TYPE`
- `413`: `ERR_FILE_TOO_LARGE`
- `429`: `ERR_ASSET_RATE_LIMITED`
- `500`: `ERR_BLOB_TOKEN_MISSING`
- `502`: `ERR_ASSET_UPLOAD_FAILED`

### Note operative
- Endpoint pensato per cloud mode tenant editor: evita payload base64 nel content JSON.
- L’URL Blob viene salvata nei dati pagina e poi persistita tramite `hotSave`.

---

## 2.5) `GET /api/v1/assets/list` (tenant media library)

### Auth
- Header: `Authorization: Bearer <api_key>`
- Header opzionale: `x-correlation-id`

### Input
- Query params opzionali:
  - `limit` (default `60`, range `1..200`)
  - `cursor` (opaque cursor di paginazione Blob)

### Flusso funzione
1. Resolve `correlationId`.
2. Valida Bearer API key e tenant lookup su `tenants`.
3. Valida token Blob (`BLOB_READ_WRITE_TOKEN` o `JSONPAGES_READ_WRITE_TOKEN`).
4. Esegue `list()` su Vercel Blob con prefix tenant-scoped: `tenant-assets/<tenantId>/`.
5. Filtra best effort i path fuori prefix tenant (defense in depth).
6. Mappa output in contract compatibile `LibraryImageEntry`:
   - `id`, `url`, `alt`, `tags`
   - metadata accessorie: `pathname`, `contentType`, `uploadedAt`
7. Ritorna `items` + `cursor` + `hasMore`.

### Output
- `200`: `{ ok: true, correlationId, tenantId, tenantSlug, items, cursor, hasMore }`
- `401`: `ERR_UNAUTHORIZED`
- `403`: `ERR_INVALID_API_KEY`
- `500`: `ERR_BLOB_TOKEN_MISSING`
- `502`: `ERR_ASSET_LIST_FAILED`

### Note operative
- Endpoint usato dal tenant editor in cloud mode per popolare la tab `Libreria` dell’Image Picker.
- Isolamento tenant garantito da auth API key + prefix Blob derivato da tenant risolto lato server.

---

## 4) `POST /api/v1/tenants/create` (legacy sync)

### Input
- Body: `{ installationId, userId, slug, ownerLogin, accountType?: "User" | "Organization" }`

### Flusso funzione
1. Crea repo template su GitHub (con fallback copia blob).
2. Crea progetto Vercel.
3. Inietta env principali.
4. Inserisce tenant in Supabase.
5. Best effort set di `JSONPAGES_TENANT_ID`.
6. Ritorna JSON success.

### Status matrix (runtime)
| Status | Condizione | Code |
|---|---|---|
| `200` | Tenant creato | n/a |
| `400` | Body incompleto o slug invalido | `ERR_BAD_REQUEST` |
| `402` | Limite Vercel raggiunto / 403 su create project | `ERR_VERCEL_LIMIT_REACHED` |
| `403` | GitHub template forbidden | `ERR_GITHUB_TEMPLATE_FORBIDDEN` |
| `409` | Repository name gia esistente | `ERR_GITHUB_NAME_TAKEN` |
| `500` | Config Vercel mancante, errore DB, errore interno | `ERR_VERCEL_CONFIG`, `ERR_SUPABASE_FAILED`, `ERR_UNKNOWN` |
| `502` | Errori provider GitHub/Vercel/env | `ERR_GITHUB_FAILED`, `ERR_VERCEL_FAILED`, `ERR_VERCEL_ENV_FAILED` |

### Limiti rispetto a `provision-stream`
- Non usa SSE step-by-step.
- Non mantiene metadata naming moderni (`requested_name`, `final_project_name`, `naming_attempts`).
- Non persiste `vercel_url` canonica come nel flusso moderno.
- Non effettua attesa deploy deterministica con output live URL.

---

## 5) `POST /api/v1/link`

### Scopo
Collega un progetto gia esistente con una license key di test.

### Flusso
1. Valida campi: `licenseKey`, `repoOwner`, `repoName`, `slug`, `userId`.
2. Verifica formato license (`TEST-...`).
3. Inserisce tenant.
4. Inserisce record in `licenses`.
5. Ritorna payload progetto collegato.

### Output tipici
- `200` success
- `400` missing fields
- `403` license invalid
- `409` slug duplicato

---

## 6) `GET /api/v1/github/installations`

### Flusso
1. Costruisce link install/config GitHub App.
2. Se env GitHub mancanti, risponde con `installationsError`.
3. Altrimenti chiama `GET /app/installations` via JWT App auth.
4. Mappa output minimale per UI.

### Output
- Sempre JSON con:
  - `installUrl`, `configureUrl`
  - `installations[]`
  - opzionale `installationsError`

---

## 7) `GET /api/v1/github/repos`

### Input
- Query param: `installation_id`

### Flusso
1. Valida `installation_id`.
2. Crea octokit per installazione.
3. Paginazione `listReposAccessibleToInstallation` (`per_page=100`).
4. Ritorna lista aggregata.

### Output
- `200`: `{ repos: [...] }`
- `400`: missing query param
- `500`: errore GitHub API

---

## 8) `GET /api/v1/licensing/bridge-status`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Query:
  - `plan` (required, `starter|pro|business`)
  - `tenant_id` (optional UUID)
  - `installation_id` (optional positive integer)
  - `correlation_id` (optional)
- Header opzionali: `x-correlation-id`, `x-checkout-source`

### Output
- `200`: `{ correlationId, state, source, githubLogin, tenantId, selectedInstallationId, staleInstallationId, installUrl, configureUrl }`
- `400`: `ERR_PLAN_INVALID`, `ERR_TENANT_ID_INVALID`, `ERR_INSTALLATION_ID_INVALID`
- `500`: `ERR_BILLING_STATE_PERSIST_FAILED`, `ERR_GITHUB_APP_CONFIG_MISSING`, `ERR_GITHUB_APP_INSTALLATION_FETCH_FAILED`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 9) `POST /api/v1/licensing/create-checkout`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Body:
  - `planCode` (required)
  - `installationId` (required)
  - `tenantId` (optional UUID, per tenant scoped checkout)
  - `forceNew` (optional boolean)
  - `correlationId` (optional)
  - `source` (optional; fallback header `x-checkout-source`)
- Header opzionali: `x-correlation-id`, `x-checkout-source`

### Output
- `200` riuso checkout: `{ correlationId, tenantId, source, state, checkoutId, checkoutUrl, reused: true, checkoutAgeMs }`
- `200` nuovo checkout: `{ correlationId, state: "checkout_created", checkoutId, checkoutUrl, tenantId, source, reused: false }`
- `400`: `ERR_PLAN_INVALID`, `ERR_INSTALLATION_ID_INVALID`, `ERR_TENANT_ID_INVALID`
- `404`: `ERR_TENANT_NOT_FOUND`, `ERR_INSTALLATION_NOT_FOUND`
- `409`: `ERR_TENANT_INSTALLATION_MISMATCH`, `ERR_TENANT_PLAN_ALREADY_LICENSED`
- `500`: `ERR_LS_CONFIG_MISSING`, `ERR_CHECKOUT_STATE_PERSIST_FAILED`, `ERR_GITHUB_APP_CONFIG_MISSING`, `ERR_CHECKOUT_CREATE_UNHANDLED`
- `502`: `ERR_LS_CHECKOUT_CREATE_FAILED`, `ERR_LS_CHECKOUT_RESPONSE_INVALID`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 10) `GET /api/v1/licensing/checkout-status`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Query:
  - `plan` (required)
  - `tenant_id` (optional UUID)
  - `correlation_id` (optional)
- Header opzionali: `x-correlation-id`, `x-checkout-source`

### Output
- `200` senza record: `{ correlationId, state: "authenticated", checkoutId: null, checkoutUrl: null, installationId: null, tenantId, source, variantId: null }`
- `200` con record: `{ correlationId, state, originalState, normalizedState, checkoutId, checkoutUrl, installationId, tenantId, variantId, storeId, source, updatedAt, checkoutReusable, checkoutRecoveryRequired, checkoutRecoveryReasons, lastErrorCode, lastErrorMessage }`
- `400`: `ERR_PLAN_INVALID`, `ERR_TENANT_ID_INVALID`
- `500`: `ERR_CHECKOUT_STATUS_READ_FAILED`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 11) `GET /api/v1/licensing/pending-entitlements`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Header opzionale: `x-correlation-id`

### Output
- `200`: `{ correlationId, entitlements: [{ id, planCode, correlationId, installationId, updatedAt }] }`
- `500`: `ERR_PENDING_ENTITLEMENTS_READ_FAILED`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 12) `GET /api/v1/licensing/subscription-summary`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Query:
  - `tenant_id` (optional UUID; se presente verifica ownership tenant)
  - `correlation_id` (optional)
- Header opzionale: `x-correlation-id`

### Output
- `200`: `{ correlationId, tenantId, planCode, status, renewalAt, currentPeriodEnd, entitlementCount, canManageBilling, updatedAt, portalUrl }`
  - `status`: `active | past_due | unknown` (normalizzato)
  - fallback record: tenant scoped -> user scoped -> default safe payload
- `400`: `ERR_TENANT_ID_INVALID`
- `404`: `ERR_TENANT_NOT_FOUND`
- `500`: `ERR_ENTITLEMENT_COUNT_READ_FAILED`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 13) `GET /api/v1/licensing/portal`

### Auth
- Richiede utente autenticato (`requireRequestUser`).

### Input
- Query:
  - `tenant_id` (optional UUID; se presente verifica ownership tenant)
  - `correlation_id` (optional)
- Header opzionale: `x-correlation-id`

### Flusso
1. Risolve `ls_customer_id` da `billing_intents` (tenant scoped -> user scoped).
2. Chiama LemonSqueezy API `GET /v1/customers/{id}`.
3. Estrae `customer_portal` URL e valida hostname `*.lemonsqueezy.com`.
4. Persist `ls_portal_url` best effort.
5. Ritorna JSON con `portalUrl` (client-side redirect).

### Output
- `200`: `{ correlationId, tenantId, customerId, portalUrl }`
- `400`: `ERR_TENANT_ID_INVALID`
- `404`: `ERR_TENANT_NOT_FOUND`, `ERR_PORTAL_CUSTOMER_NOT_FOUND`, `ERR_PORTAL_LINK_UNAVAILABLE`
- `500`: `ERR_PORTAL_PROVIDER_CONFIG_MISSING`
- `502`: `ERR_PORTAL_PROVIDER_FAILED`
- Auth failure: passthrough `requireRequestUser` (`401`/`500`)

---

## 14) `POST /api/v1/webhooks/ls`

### Auth / Security
- Nessuna auth utente.
- Verifica firma HMAC SHA-256:
  - header `x-signature`
  - secret env `LS_WEBHOOK_SECRET`
  - confronto costante (`timingSafeCompare`)
- Idempotenza su `event_key` (duplicate => `ok: true, duplicate: true`).

### Input
- Body: raw JSON payload LemonSqueezy.
- Header opzionale: `x-correlation-id`.

### Output
- `200` processed: `{ ok: true, eventName, state, correlationId }`
- `200` duplicate: `{ ok: true, duplicate: true, correlationId }`
- `200` ignored: `{ ok: true, ignored: true, reason: "missing_user" | "invalid_plan", correlationId, rawPlanCode? }`
- `400`: `ERR_LS_WEBHOOK_JSON_INVALID`
- `401`: `ERR_LS_WEBHOOK_SIGNATURE_INVALID`
- `500`: `ERR_LS_WEBHOOK_SECRET_MISSING`, `ERR_LS_WEBHOOK_EVENT_PERSIST_FAILED`, `ERR_LS_WEBHOOK_STATE_READ_FAILED`, `ERR_LS_WEBHOOK_STATE_PERSIST_FAILED`

### Production Runbook (Webhook Incident)
- Sintomo UI: checkout resta su `Waiting payment confirmation...`.
- Verifica 1 (Delivery): in Lemon Squeezy il delivery deve essere `POST` verso `https://app.jsonpages.io/api/v1/webhooks/ls` con status `200`.
- Verifica 2 (Status code):
  - `405`: endpoint/url o method errata (evento non processato).
  - `401 ERR_LS_WEBHOOK_SIGNATURE_INVALID`: `LS_WEBHOOK_SECRET` non allineato con signing secret webhook.
  - `500 ERR_LS_WEBHOOK_SECRET_MISSING`: env mancante nel runtime.
- Verifica 3 (DB): su `billing_intents` il record `user_id + plan_code` deve avanzare da `checkout_created|payment_pending` a `licensed_ready_unassigned|licensed_ready_assigned`.
- Verifica 4 (API): `GET /api/v1/licensing/checkout-status` deve ritornare stato `licensed_ready_*`; se `resolvedViaFallback=true`, indagare mismatch `correlation_id`.
- Verifica 5 (Log server): controllare eventi `[licensing.webhook.ls]`, campi `existingIntentLookup`, `previousState`, `state`, `preventedRegression`.

---

## 15) `POST /api/v1/forms/submit`

### Auth
- Header: `Authorization: Bearer <api_key tenant>`
- Header opzionali: `Idempotency-Key`, `x-correlation-id`

### Security + Governance
- Rate limit IP+tenant (`FORMS_RATE_LIMIT_PER_MINUTE`).
- Policy storage upstream su tenant:
  - `forms_git_storage_enabled`
  - `forms_storage_policy`
- Runtime guardrail repo privacy (public repo => storage DB-only).

### Flusso
1. Resolve tenant via API key.
2. Idempotency replay check (`tenant_id + idempotency_key`).
3. Rate-limit window (1 min).
4. Persist lead in DB (`leads`) + audit event (`lead_events`).
5. Best effort GitHub commit (`src/data/leads/...`) when policy allows.
6. Send email via Resend with `reply_to` (if email valid in payload).
7. Update `delivery_status` e, su errore permanenti, enqueue `lead_dlq`.

### Output
- `200/202`: submit processed (`partialSuccess` when Git write fails but delivery succeeds)
- `401/403`: auth errors
- `429`: rate limited (`ERR_FORM_RATE_LIMITED`)
- `502`: lead persisted but delivery failed (`ERR_RESEND_SEND_FAILED` family)

---

## 16) `POST /api/v1/webhooks/resend`

### Security
- Verifica firma Svix:
  - headers `svix-id`, `svix-timestamp`, `svix-signature`
  - secret env `RESEND_WEBHOOK_SECRET`

### Flusso
1. Validazione firma e JSON.
2. Persist evento raw in `lead_webhook_events` (idempotenza su event key).
3. Mapping eventi:
   - `email.sent` -> `sent`
   - `email.delivered` -> `delivered`
   - `email.bounced` -> `error`
   - `email.complaint` -> `warning`
4. Update lead via `resend_id` + append `lead_events`.

### Output
- `200`: processed
- `200`: duplicate (`duplicate: true`)
- `400`: invalid JSON
- `401`: invalid signature

---

## 17) `GET /api/v1/tenants/:id/leads`

### Auth
- Richiede utente autenticato (`requireRequestUser`).
- Tenant isolation con `assertTenantAccess(..., requiredRole: "editor")`.

### Input
- Query opzionali:
  - `limit` (default 50, max 200)
  - `offset` (default 0)
  - `status` (`received|sent|delivered|warning|error`)

### Output
- `200`: `{ correlationId, tenantId, leads, count, limit, offset }`
- `403/404`: tenant access denied / not found
- `500`: `ERR_LEADS_LIST_FAILED`

---

## 18) `GET /api/v1/tenants/:id/leads/:leadId/events`

### Auth
- Richiede utente autenticato (`requireRequestUser`).
- Tenant isolation con `assertTenantAccess(..., requiredRole: "editor")`.

### Input
- Query opzionale: `limit` (default 50, max 200)

### Output
- `200`: `{ correlationId, tenantId, leadId, events }`
- `404`: `ERR_LEAD_NOT_FOUND`
- `500`: `ERR_LEAD_LOOKUP_FAILED`, `ERR_LEAD_EVENTS_LIST_FAILED`

---

## 19) Tenant Domains

### `GET /api/v1/tenants/:id/domains` (lista domini)

#### Auth
- `requireRequestUser` + `assertTenantAccess(editor)` + `assertDomainGovernance`

#### Output
- `200`: `{ correlationId, tenantId, domains: [...] }`
- `403`: accesso negato o governance check fallito
- `500`: `ERR_DOMAIN_LIST_FAILED`

### `POST /api/v1/tenants/:id/domains` (aggiungi dominio)

#### Auth
- `requireRequestUser` + `assertTenantAccess(admin)` + `assertDomainGovernance`
- Rate limit: `enforceDomainMutationRateLimit`

#### Input
- Body: `{ domain: string }`
- Header opzionale: `Idempotency-Key`

#### Flusso
1. Normalizza e valida dominio.
2. Idempotency replay check.
3. Verifica conflitti (stesso tenant -> riuso, altro tenant -> 409).
4. Insert `tenant_domains` con `status: pending_dns`.
5. Aggiunge dominio su Vercel, legge status/config e aggiorna status.
6. Popola `verification_targets` dai check reali del provider (source of truth runtime).
7. Include anche i record raccomandati da config provider (es. `recommendedCNAME`/`recommendedIPv4`) quando presenti.
8. `conflict` solo con conflitti reali del provider; `active` solo con `verified=true` e `config.misconfigured=false`.
9. `config.misconfigured=true` o `config.configuredBy=null` mantiene `pending_dns`.
10. Se il provider non restituisce ancora check DNS, mantiene `verification_targets.checks` vuoto fino al prossimo refresh/verify/reconcile.
11. Su fallimento Vercel: enqueue in `tenant_domain_dlq`.

#### Output
- `200`: dominio riusato (gia esistente per tenant)
- `201`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `409`: `ERR_DOMAIN_CONFLICT`, `ERR_VERCEL_PROJECT_MISSING`
- `429`: rate limit mutation
- `500`: `ERR_DOMAIN_PERSIST_FAILED`
- `502`: `ERR_VERCEL_DOMAIN_ADD_FAILED`

### `GET /api/v1/tenants/:id/domains/:domain` (stato dominio)

#### Auth
- `requireRequestUser` + `assertTenantAccess(editor)` + `assertDomainGovernance`

#### Input
- Query: `verify=0` per disabilitare auto-verifica

#### Output
- `200`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `502`: `ERR_DOMAIN_STATUS_FAILED`

### `DELETE /api/v1/tenants/:id/domains/:domain` (rimuovi dominio)

#### Auth
- `requireRequestUser` + `assertTenantAccess(admin)`
- Rate limit: `enforceDomainMutationRateLimit`

#### Output
- `200`: `{ correlationId, tenantId, domain: { id, domain, status: "deleted" } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `429`: rate limit mutation
- `502`: `ERR_DOMAIN_REMOVE_FAILED`

### `POST /api/v1/tenants/:id/domains/:domain/verify` (verifica dominio)

#### Auth
- `requireRequestUser` + `assertTenantAccess(admin)` + `assertDomainGovernance`

#### Output
- `200`: `{ correlationId, tenantId, domain: { id, domain, status, verification_targets } }`
- `404`: `ERR_DOMAIN_NOT_FOUND`
- `502`: `ERR_DOMAIN_VERIFY_FAILED`

---

## 20) `POST /api/v1/tenants/previews/bootstrap`

### Auth
- `requireRequestUser`

### Input
- Body: `{ tenantIds?: string[], priorityTenantIds?: string[] }`

### Flusso
1. Carica i tenant richiesti (`tenantIds`) per l’utente autenticato; filtra quelli senza `vercel_url`.
2. Prioritizza `priorityTenantIds` (anche se la preview è già `ready`, utile per refresh manuale dalla card).
3. Per gli altri, esclude `ready` con immagine salvo stale su `pending` (soglia `TENANT_PREVIEW_PENDING_STALE_MS`, default 10 min).
4. Limita ai primi `N` candidati (`TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE`, default 4, max 8).
5. Per ogni candidato chiama `refreshTenantPreview` **in sequenza** (non `Promise.all`) per ridurre pressione CPU/memoria su serverless.

### Env rilevanti (platform)
- `TENANT_PREVIEW_PENDING_STALE_MS`, `TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE`
- Variabili capture in `tenantPreview.ts` (vedi sotto § Preview capture) e opzionale `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` se i deploy tenant sono sotto Deployment Protection.

### Output
- `200`: risultato bootstrap con dettagli per tenant (`queued`, `completed`, `failed`, `failed[]` con `errorCode` / `message` per troubleshooting)

### Preview capture (condiviso con internal refresh / reconcile)
- Implementazione: `src/lib/tenantPreview.ts` (Playwright + `@sparticuz/chromium`, upload Vercel Blob).
- **Allowlist host:** sempre `*.vercel.app`; più `TENANT_PREVIEW_ALLOWED_HOSTS` (CSV) e domini `tenant_domains` attivi/verificati per validazione DNS.
- **Vercel Deployment Protection:** senza bypass, `goto` su URL protetti può mostrare la pagina auth Vercel nello screenshot. Secret progetto-tenant → env platform `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` (header `x-vercel-protection-bypass`).

---

## 21) `POST /api/v1/tenants/:id/save2edge-snapshot`

### Auth
- `requireRequestUser` + `assertTenantAccess(owner)`

### Flusso (SSE)
1. Verifica feature flag `SAVE2ROUTES_BETA`.
2. Carica file JSON dal repository GitHub tenant (`src/data/config/site.json`, `src/data/pages/*.json`).
3. Mappa file in payload content via `mapRepoJsonFilesToEdgeEntries`.
4. Scrive snapshot completo in Supabase via `replaceTenantContent`.
5. Aggiorna metadata tenant.

### Eventi SSE
- `step`: `gather_repo`, `map_content`, `write_store`, `finalize`
- `log`: messaggi incrementali per step
- `error`: errore con `code` e `correlationId`
- `done`: `{ correlationId, tenantId, namespace, entitiesWritten, pagesWritten, configWritten, completedAt }`

### Error codes
- `ERR_SAVE2EDGE_DISABLED`, `ERR_UNAUTHORIZED`, `ERR_TENANT_NOT_FOUND`
- `ERR_GITHUB_INSTALLATION_MISSING`, `ERR_REPO_SNAPSHOT_EMPTY`
- `ERR_TENANT_UPDATE_FAILED`, `ERR_HOTSAVE_SNAPSHOT_INTERNAL`

---

## 21b) `POST /api/v1/tenants/:id/cold-save`

### Auth
- `requireRequestUser` + `assertTenantAccess(owner)`

### Flusso (SSE)
1. Feature flags: `SAVE2ROUTES_BETA` e `SAVE_REPO_ENABLED`.
2. Legge `tenant_content_store` via `readTenantContent`.
3. Mappa payload in file repo (`site.json`, `src/data/pages/*.json`) con `tenantContentPayloadToRepoFiles`.
4. Pipeline condivisa `executeCommitBuildDeploy`: commit GitHub, deploy Vercel production, aggiorna `tenants` / `deployments`, preview refresh best-effort.

### Eventi SSE
- `step`: `gather_store`, `commit`, `build`, `live`
- `log`, `error`, `done` (`deployUrl`, `commitSha`, `filesWritten`, …)

### Error codes (estratto)
- `ERR_COLD_SAVE_DISABLED`, `ERR_STORE_EMPTY`, `ERR_VERCEL_*`, `ERR_GITHUB_*`, `ERR_TENANT_SYNC_STATE_PERSIST_FAILED`

---

## 22) `DELETE /api/v1/tenants/:id`

### Auth
- `requireRequestUser` + `assertTenantAccess(admin)`

### Input
- Path param: `id` (tenant id)
- Header opzionale: `x-correlation-id`
- Header richiesto: `Idempotency-Key` (UUID)

### Flusso
1. Verifica sessione utente e permessi tenant (`owner` o `admin`).
2. Se presente `Idempotency-Key`, risolve stato idempotenza:
   - `success` -> replay risposta precedente (`idempotentReplay: true`)
   - `pending` -> `409 ERR_TENANT_DELETE_IN_PROGRESS`
   - `error` -> replay errore precedente (`idempotentReplay: true`)
3. Elimina Blob tenant su prefissi:
   - `tenant-assets/:tenantId/`
   - `tenant-previews/:tenantId/`
4. Esegue transaction DB atomica via funzione SQL:
   - delete `deployments` del tenant
   - release entitlement (`billing_intents.tenant_id -> null`, `state -> licensed_ready_unassigned`)
   - delete `tenants`
5. Se uno step DB fallisce, rollback completo della transaction.

### Output
- `200`: `{ correlationId, tenant: { id, name, slug, deleted: true }, deleted: { deployments, entitlementsReleased, blob } }`
- `400`: `ERR_TENANT_DELETE_IDEMPOTENCY_REQUIRED`
- `401`: sessione mancante/scaduta
- `403`: accesso tenant negato o ruolo insufficiente
- `404`: `ERR_TENANT_NOT_FOUND`
- `409`: `ERR_TENANT_DELETE_IN_PROGRESS`
- `500`: `ERR_TENANT_BLOB_DELETE_FAILED` | `ERR_TENANT_DELETE_TRANSACTION_FAILED` | `ERR_TENANT_DELETE_MIGRATION_MISSING` | `ERR_TENANT_DELETE_IDEMPOTENCY_LOOKUP_FAILED` | `ERR_TENANT_DELETE_IDEMPOTENCY_INIT_FAILED`
- `502`: `ERR_TENANT_VERCEL_DELETE_FAILED`

### Nota importante licensing states
- L'elenco stati rilasciabili entitlement e' hardcoded in funzione SQL (`licensed_ready_assigned`, `licensed_ready`).
- Se vengono introdotti nuovi stati "assigned-like", aggiornare la funzione `delete_tenant_with_entitlement_release`.

---

## 22a) `GET /api/v1/tenants/:id/agents`

### Auth
- `requireRequestUser` + `assertTenantAccess(admin)`

### Input
- Path param: `id` (tenant id)
- Header opzionale: `x-correlation-id`

### Flusso
1. Valida sessione utente.
2. Verifica accesso tenant con ruolo `admin` minimo.
3. Legge credenziali in `tenant_agent_credentials` ordinate per `created_at desc`.
4. Ritorna solo metadata (nessun secret in chiaro).

### Output
- `200`: `{ correlationId, tenantId, credentials: [...] }`
- `401`/`403`: auth/access failure
- `500`: `ERR_AGENT_CREDENTIALS_LIST_FAILED`

---

## 22b) `POST /api/v1/tenants/:id/agents`

### Auth
- `requireRequestUser` + `assertTenantAccess(admin)`

### Input
- Path param: `id` (tenant id)
- Body: `{ label?: string, scopes?: Array<'read'|'write'> }`
- Header opzionale: `x-correlation-id`

### Flusso
1. Valida sessione utente e accesso tenant.
2. Normalizza scope (`read`, `write`).
3. Genera `client_id` e `client_secret`, calcola `secret_hash` SHA-256.
4. Persiste in `tenant_agent_credentials` (`client_id`, `secret_hash`, `secret_hint`, metadata).
5. Ritorna `client_secret` in chiaro una sola volta.

### Output
- `201`: `{ correlationId, tenantId, credential, clientId, clientSecret, note }`
- `401`/`403`: auth/access failure
- `500`: `ERR_AGENT_CREDENTIAL_CREATE_FAILED`

---

## 22c) `DELETE /api/v1/tenants/:id/agents/:credentialId`

### Auth
- `requireRequestUser` + `assertTenantAccess(admin)`

### Input
- Path params: `id`, `credentialId`
- Header opzionale: `x-correlation-id`

### Flusso
1. Valida sessione utente e accesso tenant.
2. Revoca credenziale attiva impostando `revoked_at`.
3. Ritorna metadata di revoca.

### Output
- `200`: `{ correlationId, tenantId, credentialId, revokedAt }`
- `404`: `ERR_AGENT_CREDENTIAL_NOT_FOUND`
- `500`: `ERR_AGENT_CREDENTIAL_REVOKE_FAILED`

---

## 22d) `GET|POST /api/v1/mcp`

### Auth
- `GET`: nessuna auth (health/info).
- `POST`: `Authorization: Bearer <access_token>` ottenuto via OAuth (`/authorize` + `/token`).

### Input
- `POST` accetta JSON-RPC:
  - `initialize`
  - `tools/list`
  - `tools/call` (`read-content`, `hot-save`, `cold-save`, `navigate-to-page`, `update-section`)

### Flusso
1. Risolve bearer token OAuth (fallback legacy secret-based ancora supportato per compat).
2. Risolve tenant (`tenants.id/api_key`) e aggiorna `last_used_at` credenziale.
3. `read-content` legge `tenant_content_store`.
4. `navigate-to-page` restituisce ack stateless dello slug target.
5. `hot-save` inoltra write verso `/api/v1/hotSave` con API key tenant.
6. `cold-save` legge `tenant_content_store`, mappa file repo e inoltra sync/deploy verso `/api/v1/save-stream` (SSE -> terminal result).
7. `update-section` aggiorna una section (`sectionId`) nel payload pagina e persiste via `hotSave`.

### Output
- JSON-RPC success/error envelope (`jsonrpc`, `id`, `result|error`).
- Errori principali:
  - unauthorized: `-32001`
  - forbidden scope: `-32003`
  - unknown method/tool: `-32601`
  - hotSave downstream failure: `-32010`

---

## 23) Internal Domains Admin

### `GET /api/v1/internal/domains/events`
- Auth: `requireDomainsAdmin`
- Query: `limit`, `tenant_id`, `domain`
- Output: `{ items: [...] }`

### `GET /api/v1/internal/domains/dlq`
- Auth: `requireDomainsAdmin`
- Query: `limit`, `pending` (default: solo pending)
- Output: `{ items: [...] }`

### `POST /api/v1/internal/domains/dlq/:id/retry`
- Auth: `requireDomainsAdmin`
- Ri-esegue operazione DLQ (add/remove/verify) su Vercel
- Output: `{ ok: true }` o errore

### `GET /api/v1/internal/domains/metrics`
- Auth: `requireDomainsAdmin`
- Output: `{ windowHours: 24, events: { success, error, pending }, pendingDomains, stuckVerifying, dlqBacklog }`

### `POST /api/v1/internal/domains/reconcile`
- Auth: `requireDomainsAdmin` o `x-cron-secret`
- Riconcilia domini pending/verifying con Vercel (cutoff 5 min)
- Output: `{ ok: true, processed, updated, failed }`

---

## 24) Internal Tenant Preview

### `POST /api/internal/tenant-preview/reconcile`
- Auth: header `x-preview-refresh-token` (valore = env **`TENANT_PREVIEW_INTERNAL_TOKEN`**)
- Riconcilia preview tenant stale

### `POST /api/internal/tenant-preview/refresh`
- Auth: header `x-preview-refresh-token` (valore = env **`TENANT_PREVIEW_INTERNAL_TOKEN`**)
- Refresh singolo preview per tenant ID o URL

---

## Env Checklist (Billing Portal)

- `LS_API_KEY`: richiesto da `create-checkout` e `licensing/portal`.
- `LS_STORE_ID`, `LS_VARIANT_STARTER_ID`, `LS_VARIANT_PRO_ID`, `LS_VARIANT_BUSINESS_ID`: richiesti da checkout/licensing.
- `LS_WEBHOOK_SECRET`: richiesto da webhook `POST /api/v1/webhooks/ls`.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`: richiesti da `POST /api/v1/forms/submit`.
- `RESEND_WEBHOOK_SECRET`: richiesto da `POST /api/v1/webhooks/resend`.
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: richiesti dalle route server per accesso DB.
- `SAVE2ROUTES_BETA`, `SAVE_HOT_ENABLED`, `SAVE_REPO_ENABLED`: feature flags per nuovi endpoint save hot/cold.
- `BLOB_READ_WRITE_TOKEN` (o alias `JSONPAGES_READ_WRITE_TOKEN`): richiesto da `POST /api/v1/assets/upload` e preview capture.
- `TENANT_PREVIEW_INTERNAL_TOKEN`: richiesto per `POST /api/internal/tenant-preview/reconcile` e `refresh` (header `x-preview-refresh-token`).
- `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` (optional): bypass automazione Vercel per screenshot su deploy tenant protetti.
- Altri tuning preview: `TENANT_PREVIEW_TIMEOUT_MS`, `TENANT_PREVIEW_SETTLE_MS`, `TENANT_PREVIEW_READY_SIGNAL_*`, `TENANT_PREVIEW_ALLOWED_HOSTS`, `TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE`, `TENANT_PREVIEW_PENDING_STALE_MS` (vedi `CONTEXT.md` e `src/lib/tenantPreview.ts`).
- `ASSETS_MAX_UPLOAD_BYTES` (optional): dimensione max upload (bytes).
- `ASSETS_UPLOAD_RATE_LIMIT_PER_MINUTE` (optional): rate limit per tenant (best effort per istanza).

---

## Cross-Endpoint Comparison: `save` vs `save-stream`

| Aspetto | `/save` | `/save-stream` |
|---|---|---|
| Contratto | JSON sync | SSE (`step/log/error/done`) |
| Commit GitHub | Si | Si |
| Deploy Vercel | No | Si (trigger esplicito + polling per ID) |
| URL live | Non gestita | Canonical URL risolta e salvata su tenant |
| Error handling | Base | Granulare con codici specifici |
| UX client | fire and forget | Progress realtime e stato finale affidabile |

---

## Checklist regressione docs->route

Da rieseguire ad ogni modifica in `src/app/api/v1/**/route.ts`:

1. Inventory endpoint: ogni route presente deve comparire nella tabella iniziale.
2. Auth/header: verificare che `requireRequestUser`, API keys, webhook signatures e header custom siano riflessi in docs.
3. Request contract: query/body/optional fields allineati a runtime.
4. Response matrix: status code e payload principali (success + error) documentati.
5. Error codes: includere nuovi `ERR_*` introdotti nelle route.
6. SSE contracts: se endpoint stream, aggiornare eventi/campi emessi (`step/log/error/done`).
7. Versioning: mantenere namespace e naming coerenti con `/api/v1/...`.

---

## Consigli pratici per client integration

- Per editing contenuti in produzione, usare `/api/v1/save-stream`.
- Trattare `done` come unico segnale di publish completato nei flussi SSE.
- Usare `deployUrl` da eventi `done` o `tenant.vercel_url` persistita, non URL costruite manualmente.
- Usare `correlationId` in log client/server per troubleshooting cross-service.

---

## OAuth Connector Endpoints (root)

Per connector remoti (es. Claude custom connector), oltre a `/api/v1/mcp` sono esposti endpoint OAuth a root:

- `GET /authorize` (Authorization Code + PKCE)
- `POST /token` (code -> bearer access token)
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
