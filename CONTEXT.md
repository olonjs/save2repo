# Contesto progetto JsonPages Platform

## Hosting e account

- **Vercel**: deploy su account **Team Pro**.
- Il progetto `jsonpages-platform` è configurato su Vercel con le variabili d'ambiente sotto (tutte in "All Environments" dove non indicato diversamente).

## Variabili d'ambiente (Vercel – platform)

| Variabile | Uso |
|-----------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server, bypass RLS) |
| `GITHUB_APP_ID` | GitHub App ID (Octokit) |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (PEM) |
| `VERCEL_AUTH_TOKEN` | Vercel API auth |
| `VERCEL_TEAM_ID` | Vercel team |
| `EDGE_CONFIG` | Connection string Edge Config (source of truth per `save2edge`/`save2repo`; da qui si estrae `ecfg_...`) |
| `JSONPAGES_CLOUD_URL` | (Opzionale) Base URL API platform, default `https://app.jsonpages.io/api/v1` |
| `SAVE2ROUTES_BETA` | Abilita nuovi endpoint `save2edge`/`save2repo` |
| `SAVE_HOT_ENABLED` | Gate specifico endpoint hot (`save2edge`) |
| `SAVE_REPO_ENABLED` | Gate specifico endpoint cold sync (`save2repo`) |
| `JSONPAGES_BLOB_PUBLIC_BASE` | Base URL pubblica del Blob store (es. `https://{hash}.public.blob.vercel-storage.com`). Usata dal provision-stream per iniettare `BLOB_TENANT_DISCOVERY_BASE` sui progetti tenant e da `tenantStaticFiles.ts` per upload discovery files. |
| `LEMONSQUEEZY_*` | Billing (configurate ma uso da verificare) |
| `VERCEL_WEBHOOK_SECRET` | Webhook signing (uso da verificare) |
| `TENANT_PREVIEW_INTERNAL_TOKEN` | Secret per header `x-preview-refresh-token` sulle route `POST /api/internal/tenant-preview/*` (cron / tool). Non confondere con `PREVIEW_REFRESH_TOKEN` (nome legacy in alcune note). |
| `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` | (Opzionale) Secret **Protection Bypass for Automation** generato sul **progetto Vercel del tenant** (Settings → Deployment Protection). Va impostato sul **deploy della platform**: Playwright invia `x-vercel-protection-bypass` prima di `goto`. Un solo valore globale: se ogni tenant ha secret diverso, in futuro servirà campo per-tenant. |
| `TENANT_PREVIEW_PENDING_STALE_MS` | (Opzionale) Soglia ms dopo cui un tenant in `preview_status=pending` è considerato “stale” per il bootstrap (default 10 min). |
| `TENANT_PREVIEW_BOOTSTRAP_BATCH_SIZE` | (Opzionale) Numero massimo di tenant processati per richiesta bootstrap (default 4, max 8). I refresh nella batch sono **sequenziali** (uno dopo l’altro). |

### Variabili capture (`src/lib/tenantPreview.ts`)

| Variabile | Uso |
|-----------|-----|
| `TENANT_PREVIEW_TIMEOUT_MS` | Timeout `page.goto` / capture (default 14000). |
| `TENANT_PREVIEW_RETRIES` | Tentativi capture (default 1 retry aggiuntivo). |
| `TENANT_PREVIEW_WAIT_UNTIL` | `domcontentloaded` \| `load` \| `networkidle` \| `commit`. |
| `TENANT_PREVIEW_SETTLE_MS` | Attesa dopo ready signal (default 400). |
| `TENANT_PREVIEW_READY_SIGNAL_TIMEOUT_MS` | Attesa `__TENANT_PREVIEW_READY__` / `data-preview-ready` (default 6000; 0 = disabilita). |
| `TENANT_PREVIEW_READY_SIGNAL_FALLBACK_WAIT_MS` | Se il ready signal scade, fallback `networkidle` (ms). |
| `TENANT_PREVIEW_REQUIRE_READY_SIGNAL` | Se `true`, senza signal → errore (default false). |
| `TENANT_PREVIEW_ALLOWED_HOSTS` | CSV hostname aggiuntivi oltre a `vercel.app` e domini tenant (allowlist sicurezza). |
| `TENANT_PREVIEW_VIEWPORT_WIDTH` / `TENANT_PREVIEW_VIEWPORT_HEIGHT` | Viewport screenshot. |
| `TENANT_PREVIEW_JPEG_QUALITY` | Qualità JPEG 1–100. |
| `TENANT_PREVIEW_RECONCILE_PENDING_GRACE_MS` / `TENANT_PREVIEW_RECONCILE_LIMIT` | Reconcile interno (cron). |

## URL convention dei tenant

Tre URL distinti, non confondere:

| Campo | Natura | Esempio | Quando si aggiorna |
|-------|--------|---------|--------------------|
| `tenants.vercel_url` | **Deployment URL** (per-deploy, immutabile, include hash) | `https://santamamma-i7zq3h4n0-jsonpages.vercel.app` | A ogni cold-save (prende `deployment.alias[0]` via `toCanonicalLiveUrl`, fallback su `<project>.vercel.app`). |
| `tenants.vercel_public_url` | **Public URL** (alias canonico del progetto Vercel, stabile) | `https://santamamma.vercel.app` | Al provisioning (da `vercelSlug` / `projectData.name`) e a ogni cold-save. Helper: `derivePublicVercelUrl()` in `src/lib/vercelUrls.ts`. |
| `tenant_domains.domain` (status `active`/`verified`) | **Custom domain** gestito via tab Domains | `www.santamamma.it` | Solo tramite flow Domains (Vercel Domains API + DLQ). |

Regole:
- L'Overview del tenant mostra **Public URL** + **Deployment URL** separati; il custom domain vive nel tab Domains.
- Per condividere il sito pubblicamente si usa la **Public URL** (o il custom domain se presente), **non** la Deployment URL.
- Chi scrive codice di cold-save o provisioning deve aggiornare `vercel_public_url` usando `derivePublicVercelUrl()` — non ricostruire l'URL inline.

## Preview card dashboard (screenshot tenant)

- **URL catturato:** `tenants.vercel_url` (HTTPS). Non si usa il dominio custom come sorgente primaria, per evitare redirect / siti distinti (es. apex vs `app.*`).
- **Provenienza `vercel_url`:** al provision, `waitForDeployReady` legge l’ultimo deployment da API Vercel e salva `latest.alias?.[0] ?? latest.url` (vedi `provision-stream`). L’hostname `*.vercel.app` include lo **slug del team** Vercel (es. `…-jsonpages.vercel.app`); non è stringa inventata dall’app.
- **Chi viene “visitato”:** il server della **platform** (Playwright) apre l’URL del **progetto tenant** su Vercel — non il deploy della dashboard. `NEXT_PUBLIC_APP_URL` non influisce sulla preview.
- **Deployment Protection (Vercel):** se attiva sul **progetto tenant** (o per default a livello **team**), richieste senza sessione (headless) possono ricevere **401** e lo screenshot mostra la **pagina di protezione Vercel**, non l’app. Il dominio di produzione custom può restare raggiungibile dal browser anche quando l’alias `.vercel.app` è protetto. Mitigazioni: disattivare / regolare la protezione sul progetto tenant, oppure **Protection Bypass for Automation** + `TENANT_PREVIEW_VERCEL_PROTECTION_BYPASS` sulla platform. I default Vercel possono cambiare nel tempo: conviene monitorare changelog / team settings.
- **Segnale “pronto” sul tenant:** il sito tenant può esporre `window.__TENANT_PREVIEW_READY__ === true` o `document.body.dataset.previewReady === '1'` dopo il render utile, per ridurre screenshot vuoti (app che caricano da cloud).

## Flussi API tenant

| Endpoint | Uso |
|----------|-----|
| **POST /api/v1/tenants/create** | Saga sincrona legacy (non usata dal modal). |
| **POST /api/v1/tenants/provision-stream** | SSE unificato: source `template` o `repository` → progetto Vercel → env → trigger deploy → attesa READY → INSERT tenant. Usato dal modal "New Project". |
| **POST /api/v1/tenants/:id/save2edge-snapshot** | HotSave Snapshot: repo JSON → `tenant_content_store` (dashboard owner, SSE). |
| **POST /api/v1/tenants/:id/cold-save** | Cold save: `tenant_content_store` → repo JSON + deploy production (dashboard owner, SSE). |
| **POST /api/v1/save2edge** | Hot save su Edge Config con dirty-state tracking (`unsynced_changes_count`). |
| **POST /api/v1/save2repo** | Cold sync Edge→GitHub→Vercel con SSE e reset dirty-state su successo. |
| **GET /api/v1/content** | Read tenant-scoped da Edge Config per bootstrap cloud-first del tenant. |

- **Env inviate ai progetti Vercel dei tenant:** `VITE_JSONPAGES_CLOUD_URL`, `VITE_JSONPAGES_API_KEY` (prefisso `VITE_` necessario perché il tenant è un app Vite che legge `import.meta.env`). `VITE_VERCEL_EDGE_CONFIG_ID` non è più necessaria nel nuovo flusso centralizzato.
- **Tenant bootstrap runtime:** se il tenant ha `VITE_JSONPAGES_CLOUD_URL` + `VITE_JSONPAGES_API_KEY`, prova `GET /api/v1/content` (cloud-first). Se il read cloud fallisce, usa fallback locale (`src/data/**`) e mostra feedback esplicito in UI admin.
- **Nome progetto Vercel:** se il nome (es. `green`) è già usato nel team, si prova con suffisso random (es. `green-a1b2c3d4`) fino a trovare un nome libero (max 10 tentativi).
- **Errori:** a ogni risposta negativa da Vercel (4xx/5xx) il flusso si ferma: `send('error', ...)`, chiusura stream, nessun passo successivo.

## Dashboard e modal Create Tenant

- **Dashboard** (`/dashboard`): lista progetti, bottone "New Project" apre il modal.
- **Overview progetto** (`/dashboard/{id}`): **HotSave Snapshot** (repo → Supabase store) e **Cold save** (store → repo + Vercel) accanto; richiedono `SAVE2ROUTES_BETA` e per cold save anche `SAVE_REPO_ENABLED`.
- **Modal:** Step 1 = scegli installazione GitHub; Step 2 = scegli sorgente (repository esistente o template). Poi DopaComponent (SSE) con step repo → Vercel → env → deploy → db.
- **Successo:** schermata "Tenant live!" con countdown 5 s, poi redirect a `/dashboard/{id}?tab=overview`. In caso di errore: messaggio + Chiudi / Riprova.

## Remote MCP Gateway (agenti remoti tipo Claude)

Espone un subset di WebMCP come endpoint JSON-RPC autenticato per agenti esterni.

- **Endpoint raccomandato (tenant-scoped):** `POST /api/v1/mcp/t/[tenant]` — `tenant` = slug (o UUID). Il gateway verifica che la credenziale risolta appartenga a quel tenant: mismatch → `403 -32002 Tenant mismatch`. Questa è l'URL da dare agli agenti per evitare che token vecchi / cache lato client servano il tenant sbagliato.
- **Endpoint legacy (shared):** `POST /api/v1/mcp` — stesso handler, nessun coherence check. Da non usare per nuovi tenant.
- **Handler condiviso:** `src/lib/mcpGatewayHandler.ts` (`handleMcpJsonRpc`). Entrambe le route sopra delegano qui.

### Auth flow (OAuth 2.0 Authorization Code + PKCE)

1. Tenant owner crea credenziali nel tab **API/Agents** del tenant (`/dashboard/[id]?tab=agents`). L'API `POST /api/v1/tenants/[id]/agents` genera `client_id` (prefisso `olon_client_`) e `client_secret` (prefisso `olon_sk_`, mostrato solo al momento della creazione).
2. Agenti OAuth (Claude connector, ecc.) seguono:
   - `.well-known/oauth-authorization-server` + `.well-known/oauth-protected-resource`
   - `/authorize` (user consent, PKCE challenge)
   - `/token` (code → access token; supporta Basic auth)
3. Il gateway accetta bearer access token (OAuth) o segreto diretto (legacy fallback). Vedi `src/lib/mcpGatewayAuth.ts::resolveMcpGatewayTenantContext`.
4. Credenziali in `tenant_agent_credentials` (RLS: solo owner del tenant). Secret hashato SHA256, revoca via `revoked_at`.

### Tool esposti (in `tools/list`)

`whoami`, `read-content`, `hot-save`, `cold-save`, `navigate-to-page`, `update-section`. Scope-gated: `read` / `write`.

### Diagnostica

- `POST /api/v1/mcp/t/[tenant]` con method `tools/call`, tool `whoami` → ritorna `tenantId`, `tenantSlug`, `credentialId`, `clientId`, `authMode`, `scopes`.
- `GET|POST /api/v1/agents/whoami` (Basic auth con `client_id`/`client_secret`) → verifica diretta dal DB quale tenant risolve la credenziale, bypass OAuth.

## GitHub App (per Create from template)

- Permessi richiesti: **Repository creation**, **Contents** (read/write).
- Per **Organization** si usa `createInOrg`; per **User** `createForAuthenticatedUser`. Il frontend passa `accountType` e `ownerLogin` dalla lista installazioni.
- Dopo modifiche ai permessi, reinstallare l'App sull'account/org.

## Supabase

- Migrazione: `supabase/migrations/20250223000000_tenants_saga_fields.sql` (campi `github_repo_id`, `vercel_project_id`, `status` su `tenants`). Eseguire in SQL Editor o via CLI.
- Migrazione hot/cold: `supabase/migrations/20260310120000_save_hot_cold_fields.sql` (campi `vercel_edge_config_id`, `unsynced_changes_count`, `last_hot_save_at`, `last_cold_sync_at`, `sync_status`).
- Migrazione agent credentials: `supabase/migrations/20260417100000_tenant_agent_credentials.sql` + `..._client_id.sql` (tabella `tenant_agent_credentials` con RLS tenant-owner).
- Migrazione Public URL: `supabase/migrations/20260417130000_tenants_vercel_public_url.sql` (colonna `vercel_public_url` + backfill da `final_project_name`/`slug`).

## Template tenant

- Sorgente template: org GitHub **olonjs**. La galleria nel modal "Da template" è alimentata dinamicamente da `GET /api/v1/templates`, che lista i repository pubblici dell'org con flag `is_template=true` (vedi [ADR-0003](docs/decisions/ADR-0003-olonjs-templates-gallery.md) e [docs/specs/dynamic-templates-gallery.md](docs/specs/dynamic-templates-gallery.md)).
- Il client invia al backend `source.templateRepo = { owner: 'olonjs', repo }`. Il backend valida owner = `olonjs` e `is_template === true` prima di clonare via `createUsingTemplate` (o Git Data API in fallback).
- I tenant provisionati hanno framework `vite` su Vercel; il primo deploy è avviato via API (`POST /v13/deployments`) con branch `main`.
