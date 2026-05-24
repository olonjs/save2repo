# Tasks: save2repo

31 task organizzati in 5 phase. Ogni task XS/S/M (nessun L o XL — se ne emergesse uno, da spezzare prima di prenderlo in mano).

Convenzione:
- `T-0NN` task in save2repo Phase 0
- `T-A0N` task cross-project in jsonpages-platform
- `T-1NN` task save2repo Phase 1
- `T-2NN` task Phase 2 (mix save2repo + jsonpages-platform)
- `T-3NN` task Phase 3 submission

---

## Phase 0 — save2repo repo setup & pulizia

### T-001: Fork fisico clean-history
**Description:** clone parent `jsonpages-platform` con `--depth 1`, rimuovi `.git`, `git init` nuovo, commit unico "fork from jsonpages-platform"; prepara remote `origin` puntato al futuro repo pubblico GitHub `save2repo` (non ancora creato).
**Acceptance:**
- [ ] dir `/home/dev/save2repo` contiene full content del parent
- [ ] `git log --oneline` mostra 1 commit
- [ ] nessun reference al repo parent nel `.git/config`
**Verification:**
- [ ] `git -C /home/dev/save2repo log --oneline | wc -l` ritorna `1`
**Dependencies:** None
**Files:** operazioni git only
**Scope:** XS

### T-002: Identity nuovo progetto
**Description:** rinomina `package.json` (`name: "save2repo"`, `version: "0.1.0"`, rimuovi script `test:domains*` che non servono); riscrivi `README.md` (cosa è save2repo, quick start dal buyer, link agli ADR); crea `LICENSE` BUSL 1.1 con placeholder Additional Use Grant + Use Limitation (vedi [ADR-004](../decisions/ADR-004-license-busl-and-public-source.md)); crea `.env.example` documentando: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SAVE2REPO_DEPLOYMENT_TOKEN`, `OLONJS_API_BASE` (default `https://app.olon.it/api/v1`).
**Acceptance:**
- [ ] `package.json.name === "save2repo"`
- [ ] `LICENSE` contiene BUSL 1.1 con placeholder marcati `<TBD-BEFORE-MARKETPLACE-SUBMISSION>`
- [ ] `.env.example` lista tutte le env runtime richieste
**Verification:**
- [ ] `grep -c "TBD" LICENSE` ritorna ≥2 (place­holder visibili)
**Dependencies:** T-001
**Files:** `package.json`, `README.md`, `LICENSE`, `.env.example`
**Scope:** S

### T-003: Rimozione API routes out-of-scope
**Description:** cancella le route API che ADR-005/008 marcano come rimosse:
- `src/app/api/v1/licensing/**`
- `src/app/api/v1/webhooks/ls/**`
- `src/app/api/v1/webhooks/resend/**`
- `src/app/api/v1/hotSave/**`
- `src/app/api/v1/tenants/[id]/save2edge-snapshot/**`
- `src/app/api/v1/content/**`
- `src/app/api/v1/tenants/create/**` (legacy saga, sostituita da provision-stream)
- `src/app/api/v1/internal/domains/**`
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-bootstrap/**`
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-disconnect/**`
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/**`
- `src/app/api/v1/tenants/[id]/leads/**` (out of day-1 scope)
- `src/app/api/v1/forms/submit/**` (out of day-1 scope)
- `src/app/api/v1/tenants/previews/**` (out of day-1 scope)

**Acceptance:**
- [ ] tutte le cartelle sopra rimosse
- [ ] `tsc --noEmit` errori solo da consumer da fixare in T-004
**Verification:**
- [ ] `wsl -d Ubuntu --cd /home/dev/save2repo bash -lc "find src/app/api/v1/licensing src/app/api/v1/hotSave src/app/api/v1/internal/domains 2>/dev/null || true"` ritorna vuoto
**Dependencies:** T-001
**Files:** ~15 cartelle rimosse
**Scope:** M

### T-004: Rimozione lib out-of-scope
**Description:** cancella lib che ADR-005/008 marcano come rimosse:
- `src/lib/cloudflareApi.ts`
- `src/lib/licensing.ts`
- `src/lib/saveEdgeConfig.ts`
- `src/lib/saveContentCache.ts`
- `src/lib/saveRepoToEdgeMap.ts`
- `src/lib/saveStoreToRepoMap.ts`
- `src/lib/tenantContentStore.ts`
- `src/lib/domainParsing.ts`
- `src/lib/domainTelemetry.ts`
- `src/lib/formsResend.ts`
- `src/lib/formsTelemetry.ts`
- `src/lib/formsEmailTemplates.ts`
- `src/lib/tenantPreview.ts` (out of day-1 scope)
- `src/lib/tenantStaticFiles.ts` (out of day-1 scope — assets upload)
- `src/lib/tenantSubmissionSchema.ts`, `tenantSubmissionValidator.ts` (era per forms)

Rimuovi anche script orfani in `scripts/` (`domain-status-sot-test.mjs`, `custom-domains-enterprise-test.mjs`, `cf-domains-test.mjs`, `forms-resend-suite.mjs`, `domains-ui-suite.mjs`).

Fixa tutti gli import dangling nei consumer.

**Acceptance:**
- [ ] lib rimosse
- [ ] `npx tsc --noEmit` verde
- [ ] `npm run lint` verde
**Verification:**
- [ ] `wsl -d Ubuntu --cd /home/dev/save2repo bash -lc "npx tsc --noEmit"` exit 0
**Dependencies:** T-003
**Files:** ~15 lib + script files; eventuali consumer da aggiustare
**Scope:** M

### T-005: Migration baseline single-owner
**Description:** cancella `supabase/migrations/*` storiche del parent (26 file); crea `supabase/migrations/00000000000000_save2repo_baseline.sql` come unica migration consolidata:
- `users` (singola riga del owner; gestita da Supabase auth)
- `tenants` (id, slug, owner_user_id FK users, vercel_project_id, github_repo_id, vercel_url, vercel_public_url, deployment_target text default 'client_vercel' check ('client_vercel'), status, created_at, updated_at)
- `owner_integrations` (id, owner_user_id FK, vercel_oauth_token text encrypted, vercel_team_id, github_installation_id bigint, updated_at)
- `tenant_agent_credentials` (preservato da parent — single-owner adapta solo le RLS)
- `tenant_domains` (id, tenant_id FK, domain, verified bool, created_at — schema Vercel-only, no cf_zone_*)
- `tenants.admin_private_key` text encrypted (pgsodium)

RLS: tutte le tabelle owner-only (`USING (auth.uid() = owner_user_id)`).

**Acceptance:**
- [ ] file SQL valido e applicabile
- [ ] applicato in Supabase test → tutte le tabelle presenti
- [ ] RLS attive: SELECT con role anon ritorna 0 righe
**Verification:**
- [ ] `supabase db push` su test project ritorna success
- [ ] query manuale: SELECT su `pg_policies` mostra policy single-owner
**Dependencies:** T-004
**Files:** `supabase/migrations/00000000000000_save2repo_baseline.sql`; rimozione di `supabase/migrations/*` precedenti
**Scope:** M

### T-006: serverAuth single-owner adapter
**Description:** rimuovi `assertTenantAccess` multi-role e sostituisci con `assertOwner(supabase, request): Promise<{ ownerId: string }>` che assert `auth.uid()` corrisponde al row `users`. Semplifica `resolveRequestUser`. Aggiorna tutti i consumer (route API che usavano `assertTenantAccess`).
**Acceptance:**
- [ ] `serverAuth.ts` esporta `assertOwner`, non più `assertTenantAccess`
- [ ] nessun consumer importa la vecchia funzione
- [ ] `tsc --noEmit` verde
**Verification:**
- [ ] `wsl ... bash -lc "grep -rn 'assertTenantAccess' src/"` ritorna vuoto
- [ ] `npx tsc --noEmit` exit 0
**Dependencies:** T-005
**Files:** `src/lib/serverAuth.ts`; ~5-10 consumer route
**Scope:** M

### T-007: Setup CI minimo
**Description:** crea `.github/workflows/ci.yml` con job che esegue `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm run build` su push/PR. Segreti minimi (`SUPABASE_URL`, `SUPABASE_ANON_KEY` test) iniettati come env.
**Acceptance:**
- [ ] workflow esiste e triggera su PR
- [ ] tutti i job verdi su un PR di prova
**Verification:**
- [ ] GitHub Actions UI verde
**Dependencies:** T-006
**Files:** `.github/workflows/ci.yml`
**Scope:** S

### T-008: Setup deploy Vercel showcase
**Description:** deploy del save2repo nel nostro Vercel team (per dimostrare il deployment funziona pre-Marketplace); env vars: Supabase test, GitHub App olonjs credentials, `SAVE2REPO_DEPLOYMENT_TOKEN` test, `OLONJS_API_BASE=https://app.olon.it/api/v1`. Verifica home page raggiungibile + auto-migrate al boot.
**Acceptance:**
- [ ] URL Vercel pubblico raggiungibile
- [ ] home/login page accessibile (HTTP 200)
- [ ] log Vercel mostrano auto-migrate done senza errori
**Verification:**
- [ ] `curl -I <url>` ritorna 200
- [ ] log Vercel: search per "auto-migrate complete"
**Dependencies:** T-005, T-006, T-007
**Files:** `vercel.json` (eventuale), env vars in Vercel dashboard
**Scope:** M

### Checkpoint Phase 0
- [ ] tsc / lint / build verdi
- [ ] migration baseline applicata in Supabase test
- [ ] save2repo showcase raggiungibile su Vercel
- [ ] **review con utente prima di Phase 1**

---

## Phase A — Cross-project deps in jsonpages-platform

### T-A01: Tabella save2repo_deployments + migration
**Description:** nuova migration in `jsonpages-platform/supabase/migrations/YYYYMMDDHHMMSS_save2repo_deployments.sql`: `CREATE TABLE save2repo_deployments (id uuid PK, vercel_team_id text, vercel_project_id text, vercel_configuration_id text, github_installation_id bigint nullable, registration_token_hash text, subscription_status text, plan text, created_at, updated_at)`. RLS service-role only.
**Acceptance:**
- [ ] migration applicata in jsonpages-platform Supabase
- [ ] SELECT funziona; INSERT funziona con service role
**Verification:**
- [ ] query manuale
**Dependencies:** None (lavoro su jsonpages-platform, indipendente da save2repo Phase 0)
**Files:** `jsonpages-platform/supabase/migrations/<timestamp>_save2repo_deployments.sql`
**Scope:** S

### T-A02: Endpoint GitHub installation-token signing
**Description:** in jsonpages-platform, `POST /api/v1/github/installation-token`:
1. Riceve `Authorization: Bearer <deployment_token>`
2. Hash bearer, query `save2repo_deployments WHERE registration_token_hash = ?`
3. Verifica body `{ installation_id }` corrisponde alla row
4. Firma JWT con `GITHUB_APP_PRIVATE_KEY` (env esistente)
5. Chiama GitHub `POST /app/installations/{id}/access_tokens`
6. Ritorna `{ token, expires_at }`

CORS: solo origins `*.vercel.app` (i deployment buyer). Rate limit per deployment.

**Acceptance:**
- [ ] 200 + token su request autenticate
- [ ] 401 senza bearer; 403 per installation_id mismatch
- [ ] CORS funzionante
**Verification:**
- [ ] curl test con bearer corretto: 200; bearer sbagliato: 401; installation mismatch: 403
- [ ] smoke test E2E da save2repo showcase
**Dependencies:** T-A01
**Files:** `jsonpages-platform/src/app/api/v1/github/installation-token/route.ts`, `jsonpages-platform/src/lib/save2repoDeployments.ts`
**Scope:** M

### T-A03: Marketplace install callback handler (skeleton)
**Description:** in jsonpages-platform, `POST /api/integrations/vercel/install`: skeleton che:
1. Riceve query `code`, `teamId`, `configurationId`, `next`
2. Exchange `code` per Vercel access token (Marketplace Provider API)
3. Genera `registration_token` (`s2r_dep_<random>`), hash, INSERT `save2repo_deployments`
4. Ritorna `redirect(next)` (placeholder — provisioning logic in T-202)

**Acceptance:**
- [ ] endpoint riceve params + crea row + ritorna 302 redirect
- [ ] token in hash format, non plain in DB
**Verification:**
- [ ] test endpoint con fake code; verifica row creata
**Dependencies:** T-A01
**Files:** `jsonpages-platform/src/app/api/integrations/vercel/install/route.ts`, `jsonpages-platform/src/lib/marketplaceCallback.ts`
**Scope:** M

### T-A04: Spike — Supabase Auth config write strategy
**Description:** verificare via test diretto su Supabase project freshly-created se le 4 scritture di configurazione Supabase Auth provider GitHub possono essere fatte programmaticamente dal nostro install callback senza intervento manuale del buyer. Le 4 scritture (vedi `rules_supabase_auth_setup_full_checklist.md`):
1. Enable GitHub provider
2. Set Client ID + Client Secret = credenziali OAuth App `save2repo` centralizzate ([T-A05](#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase))
3. Set Site URL = deployment URL save2repo del buyer
4. Add deployment URL ai Redirect URLs allowlist

**Candidati API:**
- **Opzione A — GoTrue admin endpoint del project**, autenticato con `SUPABASE_SERVICE_ROLE_KEY` (project-level). Vantaggio: la key è già auto-iniettata da Supabase integration su Vercel ([ADR-007](../decisions/ADR-007-supabase-via-vercel-integration-guided-redirect.md)), nessun OAuth extra. Da verificare: GoTrue espone scrittura provider config + Site URL via SERVICE_ROLE_KEY?
- **Opzione B — Supabase Management API** (`api.supabase.com/v1/projects/{ref}/config/auth`), autenticato con Supabase access token (account-level). Svantaggio: richiede Supabase OAuth nel install flow → **riapre [ADR-007](../decisions/ADR-007-supabase-via-vercel-integration-guided-redirect.md)** (che esplicitamente rigetta l'aggiungere Supabase OAuth).

**Output:** `ADR-011-supabase-auth-config-write-strategy.md` con strategy scelta + script curl che applica i 4 cambi end-to-end su un project test, riproducibile.

**Acceptance:**
- [ ] 4 cambi applicabili e verificabili via Supabase Studio (rendering corretto in Authentication → Providers + URL Configuration)
- [ ] login GitHub funzionante su project freshly-created interamente programmatico, senza UI manuale
- [ ] ADR-011 scritto con decision: Opzione A o B + rationale + impatto su ADR-007 se B
**Verification:**
- [ ] eseguire lo script su un Supabase project test fresh, fare login GitHub: success
**Dependencies:** None (può partire subito; blocca disegno T-A05/T-A06/T-202)
**Files:** `docs/spikes/supabase-auth-admin-spike.md` (test transcript), `docs/decisions/ADR-011-supabase-auth-config-write-strategy.md`
**Scope:** S
**Critical path:** sì — risultato cambia design di T-A05, T-A06, T-202; se B, riapre anche ADR-007

---

### T-A05: Centralize OAuth App `save2repo` credentials (GitHub + Supabase)
**Description:** salvare come secrets backend nel Vercel project di jsonpages-platform 2 set di credenziali OAuth App `save2repo` distinte (riusate per ogni buyer Marketplace install):

1. **OAuth App GitHub `save2repo`** ([ADR-009](../decisions/ADR-009-auth-github-oauth-hardcoded.md)) — usata da [T-202](#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch) step 9 per scrivere le credenziali del provider GitHub nel Supabase Auth del buyer:
   - `SAVE2REPO_GITHUB_OAUTH_CLIENT_ID`
   - `SAVE2REPO_GITHUB_OAUTH_CLIENT_SECRET`

2. **OAuth App Supabase `save2repo`** ([ADR-011](../decisions/ADR-011-supabase-auth-config-write-strategy.md)) — registrata nel nostro account Supabase olonjs (cfr. [Build a Supabase OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)); usata da T-202 step 3 per il project-claim OAuth verso il Supabase project del buyer:
   - `SAVE2REPO_SUPABASE_OAUTH_CLIENT_ID`
   - `SAVE2REPO_SUPABASE_OAUTH_CLIENT_SECRET`
   - Redirect URI registrato sull'OAuth App = `https://app.olon.it/api/integrations/supabase/oauth-callback` (nuovo endpoint, parte di T-202)

Documentare nel README jsonpages-platform sezione "save2repo backend setup": dove vivono, come ruotarle, che NON vanno mai esposte al frontend né committate in repo, e procedura one-time di registrazione delle 2 OAuth App.

**Acceptance:**
- [ ] 4 secrets registrate in Vercel jsonpages-platform (production env)
- [ ] codepath T-202 le legge via `process.env.SAVE2REPO_GITHUB_OAUTH_*` + `process.env.SAVE2REPO_SUPABASE_OAUTH_*`
- [ ] README aggiornato con la sezione + procedura di setup delle 2 OAuth App
- [ ] OAuth App GitHub `save2repo` esistente + verificata (già creata per il showcase, [ADR-009](../decisions/ADR-009-auth-github-oauth-hardcoded.md))
- [ ] OAuth App Supabase `save2repo` creata nell'account olonjs Supabase + redirect URI registrato
**Verification:**
- [ ] grep nel repo non trova plaintext dei Client Secret
- [ ] T-202 può accedere a tutte e 4 (smoke test in dev contro env staging)
**Dependencies:** None (in parallelo a T-A04; può iniziare anche prima ma il secondo set Supabase deriva da ADR-011)
**Files:** `jsonpages-platform/.env.example` (placeholder), `jsonpages-platform/README.md`, env Vercel (config-only), registrazione OAuth App Supabase (config-only, dashboard Supabase)
**Scope:** S (era XS; allargato per coprire 2 OAuth App invece di 1)

---

### T-A06: Bootstrap endpoint — seed data retrieval
**Description:** nuovo endpoint `GET /api/v1/deployments/self/bootstrap` in jsonpages-platform. Bearer auth = `SAVE2REPO_DEPLOYMENT_TOKEN` (hash lookup in `save2repo_deployments`, stesso pattern T-A02). Risposta:

```json
{
  "vercel_oauth_token": "...",
  "vercel_team_id": "...",
  "github_installation_id": 12345,
  "supabase_auth_provider_configured": true
}
```

Save2repo deployato chiama questo endpoint **al primo login post-install** (nuovo step in `firstBoot.ts` o `auth/callback/route.ts`) e popola `owner_integrations` nel buyer Supabase con i valori restituiti. Idempotente: chiamate successive ritornano gli stessi valori; consumer side è "scrivi-se-non-esiste".

[T-202](#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch) popola questi valori in `save2repo_deployments` durante l'install callback. Richiede estensione schema [T-A01](#t-a01-tabella-save2repo_deployments--migration): ADD COLUMN `vercel_oauth_token_enc text`, `vercel_team_id text`, `supabase_oauth_access_token_enc text`, `supabase_oauth_refresh_token_enc text`, `supabase_auth_provider_configured bool default false` (il campo `github_installation_id bigint` è già nello schema iniziale).

Per ADR-011 i due nuovi token Supabase OAuth sono per re-config futura (es: cambio deployment URL del buyer → nuovo `PATCH` per aggiornare `site_url`/`uri_allow_list`); per il bootstrap response al primo login del buyer non sono restituiti.

**Acceptance:**
- [ ] endpoint 200 con dati validi + bearer corretto; 401 senza bearer; 403 per mismatch deployment ↔ token
- [ ] save2repo deployato consumer scrive `owner_integrations` al primo login del buyer, idempotente
- [ ] migration estende `save2repo_deployments`
- [ ] vercel_oauth_token cifrato at-rest (pgsodium o equivalente)
**Verification:**
- [ ] smoke test E2E: simulare install (manual INSERT in `save2repo_deployments` con valori test) → login save2repo → verificare `owner_integrations` popolata
**Dependencies:** T-A01 (estende), T-A02 (auth pattern riusato)
**Files:**
- jsonpages-platform: nuova migration `<timestamp>_save2repo_deployments_seed_columns.sql`, `src/app/api/v1/deployments/self/bootstrap/route.ts`, `src/lib/save2repoDeployments.ts` (extension)
- save2repo: `src/lib/firstBoot.ts` (consumer), `src/app/auth/callback/route.ts` (trigger)
**Scope:** M

---

### Checkpoint Phase A
- [ ] Endpoint token-signing raggiungibile da save2repo showcase
- [ ] Tabella deployments funzionante (incl. seed columns T-A06)
- [ ] **smoke test 1:** save2repo showcase chiama `/github/installation-token` con un test deployment registrato → token GitHub valido ricevuto
- [ ] **smoke test 2 (zero-touch readiness):** simulare install callback completo (manual INSERT in `save2repo_deployments` con seed data) → save2repo deployato consuma `/deployments/self/bootstrap` al primo login → `owner_integrations` popolata senza UI manuale
- [ ] **spike T-A04 verde** (Supabase Auth Admin API path scelto, ADR-011 scritto): blocca Phase 2 design

---

## Phase 1 — Use funnel (save2repo)

### T-101: Login GitHub OAuth + landing
**Description:** pagina `/login` con bottone "Continue with GitHub" → `supabase.auth.signInWithOAuth({ provider: 'github' })`. Pagina `/auth/callback` gestisce session. Redirect `/dashboard` post-login.

**Pre-requisito di setup:**

- **Buyer path (Marketplace install):** automatico via [T-202](#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch) (usa credenziali OAuth App `save2repo` centralizzate [T-A05](#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase) + scrittura provider Supabase Auth via strategy T-A04). Buyer non fa nulla.
- **Showcase manual path (operator del nostro team Olon, una tantum):**
  1. Creare una **OAuth App `save2repo` dedicata** su GitHub (settings/developers → New OAuth App) — vedi [ADR-009](../decisions/ADR-009-auth-github-oauth-hardcoded.md) "OAuth App dedicata vs GitHub App olonjs". **NON usare la GitHub App olonjs**: callback URL diverso + brand consent diverso.
  2. Callback URL della OAuth App = `https://<supabase-ref>.supabase.co/auth/v1/callback`.
  3. In Supabase Studio del project → Authentication → Providers → GitHub → Enable + paste Client ID + Client Secret della OAuth App save2repo.

**Acceptance:**
- [ ] click su "Continue with GitHub" → OAuth flow (consent screen mostra "save2repo") → session attiva → redirect dashboard
- [ ] Supabase auth provider GitHub configurato nel project + OAuth App dedicata creata
**Verification:**
- [ ] manual E2E
**Dependencies:** T-008
**Files:** `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/lib/supabase.ts`
**Scope:** M

### T-102: First-boot setup wizard
**Description:** helper `firstBoot.ts` che al server start verifica env runtime; middleware redirige a `/setup` se incompleto. Pagina `/setup` mostra checklist:
- Supabase ENV `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` presenti
- `SAVE2REPO_DEPLOYMENT_TOKEN` presente
- **GitHub OAuth provider abilitato** in Supabase Auth (`/auth/v1/admin/providers` o equivalente — la mancata abilitazione produce `Unsupported provider: provider is not enabled` al click di "Continue with GitHub")
- **OAuth App `save2repo` configurata** con callback URL corretto (lo deduciamo dalla presenza del Client ID + Secret sul provider GitHub di Supabase; mancano = card "Setup OAuth App save2repo")
- GitHub App olonjs installation_id presente in `owner_integrations` (se no, link install — questo è separato dall'OAuth App, vedi ADR-009)

Se complete: esegue auto-migrate idempotente (controlla `pg_tables` prima di CREATE).

**Acceptance:**
- [ ] env mancante → UI esplicita con link/istruzioni
- [ ] env complete → auto-migrate verde, ridireziona a `/dashboard`
- [ ] idempotente: ri-boot non duplica
- [ ] provider GitHub non abilitato → card "Enable GitHub provider in Supabase Auth + paste OAuth App save2repo credentials"
- [ ] GitHub App olonjs non installed → card distinta "Install GitHub App olonjs on your account"
**Verification:**
- [ ] simulare env mancanti → verificare wizard; ri-boot → no duplicate
- [ ] simulare provider GitHub Supabase disabled → wizard mostra card distinta
**Dependencies:** T-101, T-005
**Files:** `src/lib/firstBoot.ts`, `src/app/setup/page.tsx`, `src/proxy.ts`
**Scope:** M

### T-102.b: ~~Setup wizard — Supabase Auth misconfiguration detection~~ (CANCELLED)
**Status:** Cancelled — assorbito da [T-202](#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch). I 4 settings Supabase Auth (provider enable + OAuth App credentials + Site URL + Redirect URLs allowlist) vengono ora **configurati programmaticamente in modo deterministico** dall'install callback Marketplace, non detectati a wizard time. Il punto 5 (GitHub App olonjs installation_id) resta gestito da [T-204](#t-204-github-app-olonjs-install-detection--guided-redirect).

**Rationale:** il piano "zero-touch install" (dashboard raggiungibile senza che il buyer setti nulla) richiede configurazione deterministica, non detection. Detection at first-boot wizard era follow-up scoperto dopo il primo showcase deploy manuale, ma per i buyer via Marketplace è obsoleto.

**Showcase manual deploy ([T-008](#t-008-setup-deploy-vercel-showcase)):** i 4 settings restano procedura one-time documentata nel README (sezione "Auth setup smoke checklist"), non in wizard interattivo.

**Riferimenti:** `rules_supabase_auth_setup_full_checklist.md`, `rules_save2repo_oauth_app_separation.md`, [T-A04](#t-a04-spike--supabase-auth-config-write-strategy), [T-A05](#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase), [T-A06](#t-a06-bootstrap-endpoint--seed-data-retrieval).

### T-103: Vercel integration UI — status + refresh-on-expiry
**Description:** pagina `/settings/integrations` che mostra lo stato delle integration. **Happy path Marketplace:** install callback ([T-202](#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch)) ha già scritto `vercel_oauth_token` + `vercel_team_id` in `owner_integrations` via [T-A06](#t-a06-bootstrap-endpoint--seed-data-retrieval) (consumed al primo login). UI mostra "Connected: team X" + last refresh + bottone "Re-authenticate" che riapre Vercel OAuth solo se il token è scaduto/revocato. **Showcase manual path:** bottone "Connect Vercel" funziona come full OAuth ex novo (path legacy, single-owner showcase deploy).

**Acceptance:**
- [ ] post-Marketplace-install: pagina mostra "Connected" senza che il buyer abbia cliccato nulla in dashboard
- [ ] showcase manuale: "Connect Vercel" ex novo funziona
- [ ] token scaduto/revocato → UI warning + CTA "Re-authenticate"
- [ ] disconnect rimuove `owner_integrations` row (entrambe le path)
**Verification:**
- [ ] manual E2E Marketplace path: install → primo login → `/settings/integrations` mostra Connected senza interazioni
- [ ] manual E2E showcase path: connect from scratch via UI
**Dependencies:** T-101, T-A06 (per Marketplace path; showcase path indipendente)
**Files:** `src/app/settings/integrations/page.tsx`, `src/app/auth/vercel/callback/route.ts`, `src/lib/vercelAuth.ts`
**Scope:** S (era M; ridotto perché happy path è auto-popolato via T-A06)

### T-104: Token-signing client (Octokit wrapper)
**Description:** lib `githubAppClient.ts` con `getInstallationOctokit(installationId): Promise<Octokit>`:
1. Cache lookup (TTL < 50min)
2. Cache miss → fetch da `${OLONJS_API_BASE}/github/installation-token` con `Authorization: Bearer ${SAVE2REPO_DEPLOYMENT_TOKEN}` body `{installation_id}`
3. Costruisce Octokit con token ricevuto

Error UX: se endpoint down → error chiaro "olonjs backend unreachable, try again or contact support".

**Acceptance:**
- [ ] cache hit ritorna Octokit valido senza network call
- [ ] cache miss chiama endpoint e cache il token
- [ ] error path: endpoint 5xx → throw structured error
**Verification:**
- [ ] unit test mock; integration test contro endpoint reale
**Dependencies:** T-102, T-A02
**Files:** `src/lib/githubAppClient.ts`, test
**Scope:** S

### T-105: Crea tenant wizard UI
**Description:** modal 3-step "Create site":
1. galleria template da `GET /api/v1/templates` (preservato dal parent — fetcha repo `olonjs/*` is_template)
2. slug input + check disponibilità (in parallel: GET GitHub `/repos/{owner}/{slug}` + GET Vercel `/projects/{slug}`); auto-suffix on collision
3. conferma → trigger SSE `provision-stream`

**Acceptance:**
- [ ] utente seleziona template, name, conferma
- [ ] check disponibilità funziona; collision → suffix
**Verification:**
- [ ] manual E2E
**Dependencies:** T-101, T-103
**Files:** `src/app/dashboard/components/CreateTenantModal.tsx`, `src/app/dashboard/page.tsx` (CTA), conferma preservazione `src/app/api/v1/templates/route.ts`, `src/lib/olonjsTemplates.ts`
**Scope:** M

### T-106: Provision stream SSE adapter
**Description:** route `/api/v1/tenants/provision-stream` adattata da parent:
- target hardcoded `client_vercel` (rimosso dispatcher)
- usa T-104 per Octokit clone template `olonjs/*` come `<buyer>/<slug>` (via `POST /repos/{template}/generate`)
- usa T-103 token per Vercel API create project nel team buyer
- inject env tenant (`VITE_JSONPAGES_CLOUD_URL` puntato al save2repo deployment, `VITE_JSONPAGES_API_KEY` se MCP credenziali assegnate)
- trigger deploy + wait READY
- INSERT tenants row

**Acceptance:**
- [ ] SSE stream emette `step / log / done / error`
- [ ] sito tenant raggiungibile dopo done
- [ ] row `tenants` correttamente popolata
**Verification:**
- [ ] manual E2E create tenant da wizard → sito su `*.vercel.app` raggiungibile
**Dependencies:** T-104, T-105, T-A02
**Files:** `src/app/api/v1/tenants/provision-stream/route.ts`
**Scope:** M

### T-107: Editor tenant content via GitHub Contents API
**Description:** lib `githubContent.ts` con `readContent(installationId, owner, repo, path)` / `writeContent(...)` usando Octokit (T-104). Editor riusato dal parent ma data layer cambia: read da GitHub Contents API, write via PUT con commit message. Debounce client-side 5-30s.
**Acceptance:**
- [ ] editor mostra content del repo tenant
- [ ] modifiche persistono come commit (debounce funzionante)
- [ ] no più chiamate a `tenant_content_store`
**Verification:**
- [ ] manual E2E: edit → wait debounce → check commit history GitHub
**Dependencies:** T-106
**Files:** `src/lib/githubContent.ts`, `src/app/dashboard/[id]/edit/page.tsx` (adapter), eventuali editor components
**Scope:** M

### T-108: Save flow save2repo + SSE
**Description:** `saveRepoCommitDeploy.ts` adattato: commit content via Octokit (T-104); push triggera Vercel rebuild automatico via webhook esistente. SSE `save-stream` con step `commit → rebuild → ready`. UI esplicita "Saving… site live in ~30s".
**Acceptance:**
- [ ] save mostra progress UI
- [ ] commit appare in GitHub history
- [ ] sito tenant aggiornato in 30-90s
**Verification:**
- [ ] manual E2E: edit + save → verifica deploy Vercel triggered e completed
**Dependencies:** T-107
**Files:** `src/lib/saveRepoCommitDeploy.ts`, `src/app/api/v1/save-stream/route.ts`, `src/app/api/v1/save2repo/route.ts`, `src/app/api/v1/tenants/[id]/cold-save/route.ts`
**Scope:** M

### T-109: Custom domains tab
**Description:** routes preservate (`tenants/[id]/domains/route.ts`, `[domain]/route.ts`, `[domain]/verify/route.ts`) adattate a `vercel_oauth_token` del buyer. UI tab "Domains" in `dashboard/[id]`: add / verify / remove. Guida DNS textual: "punta CNAME a `cname.vercel-dns.com` sul tuo registrar".
**Acceptance:**
- [ ] add → row in `tenant_domains` + Vercel domain attached al project tenant
- [ ] verify → Vercel verifies, status update
- [ ] remove → unlink + row deleted
**Verification:**
- [ ] manual E2E con dominio test reale
**Dependencies:** T-106
**Files:** `src/app/api/v1/tenants/[id]/domains/route.ts`, `[domain]/route.ts`, `[domain]/verify/route.ts`, `src/app/dashboard/[id]/domains/page.tsx`, `src/lib/vercelDomains.ts`, `src/lib/customDomains.ts`
**Scope:** M

### T-110: MCP gateway per tenant
**Description:** `mcpGatewayHandler.ts` preservato as-is. Route `/api/v1/mcp/t/[tenant]/route.ts` adattata (auth single-owner). OAuth flow `/authorize` + `/token` preservato. Tool `save` riadattato a save2repo-only (chiama T-108 path). `tenant_agent_credentials` table preservata. UI in dashboard `/settings/agents` per creare credenziali.
**Acceptance:**
- [ ] MCP discovery endpoints rispondono per ogni tenant
- [ ] OAuth Code+PKCE flow completo funziona
- [ ] `tools/call save` end-to-end commita al repo tenant
**Verification:**
- [ ] smoke test con Claude Desktop come MCP client → modifica sezione di un tenant
**Dependencies:** T-108
**Files:** `src/app/api/v1/mcp/t/[tenant]/route.ts`, `src/app/api/v1/agents/whoami/route.ts`, `src/app/api/v1/tenants/[id]/agents/route.ts`, `src/lib/mcpGatewayHandler.ts`, `mcpGatewayAuth.ts`, `mcpGatewayCredentials.ts`, `mcpGatewayOAuth.ts`, UI agents page
**Scope:** M

### T-111: A2A + webMCP gateway
**Description:** `a2a/t/[tenant]/route.ts` preservato; `webmcpBuilders.ts` preservato; verifica funzionino con auth single-owner.
**Acceptance:**
- [ ] A2A endpoint risponde per ogni tenant
- [ ] webMCP discovery funziona
- [ ] tool call round-trip riusce
**Verification:**
- [ ] smoke test con A2A peer mock
**Dependencies:** T-110
**Files:** `src/app/api/v1/a2a/t/[tenant]/route.ts`, `src/lib/webmcpBuilders.ts`
**Scope:** S

### T-112: Tenant log passthrough
**Description:** nuovo endpoint `/api/v1/tenants/[id]/logs` fetcha log da Vercel API (`/v1/projects/{project_id}/deployments/{deployment_id}/events` o equivalente) usando `vercel_oauth_token`. UI tab "Logs" in `dashboard/[id]`.
**Acceptance:**
- [ ] log Vercel del tenant visibili nella dashboard save2repo (build logs + runtime logs filtered)
**Verification:**
- [ ] manual E2E: provoca un build error sul tenant, verifica log visibili
**Dependencies:** T-106
**Files:** `src/app/api/v1/tenants/[id]/logs/route.ts`, `src/app/dashboard/[id]/logs/page.tsx`
**Scope:** S

### Checkpoint Phase 1
- [ ] E2E manuale completo: login → connect Vercel → crea tenant da template → edit → save → sito live → custom domain
- [ ] MCP end-to-end con Claude Desktop verde (BLOCKING — è il moat)
- [ ] A2A roundtrip verde
- [ ] Telemetria base: ogni save logga `correlationId` + duration
- [ ] **review con utente prima di Phase 2**

---

## Phase 2 — Install funnel (mix jsonpages-platform + save2repo)

### T-201: Vercel Integration setup nel Console (config-only)
**Description:** in Vercel dev console del nostro team Pro:
- Crea Native Integration "save2repo" (slug, category CMS, descrizione, logo placeholder)
- API scopes minimi: `read`, `projects:write`, `env:write`, `deployments:write`, `domains:write`, `integrations:write`
- Redirect URI: `https://app.olon.it/api/integrations/vercel/install`
- Crea Product con metadata schema minimale + Base URL per Marketplace Provider API

**Acceptance:**
- [ ] integration creata nel console, status "draft"
- [ ] URL test `vercel.com/integrations/save2repo` accessibile (con accesso team)
**Verification:**
- [ ] install della draft integration su un test team triggera il callback
**Dependencies:** None
**Files:** nessuno (config-only)
**Scope:** S

### T-202: Marketplace callback handler — provisioning logic (full zero-touch)
**Description:** estendi T-A03 con la logica provisioning end-to-end. **Obiettivo "zero-touch":** il buyer atterra sulla dashboard save2repo senza settare NULLA dopo il click "Install" sul Marketplace, a parte i consent inevitabili per platform security (GitHub App olonjs install, Supabase install se mancante, primo "Continue with GitHub" sul deploy save2repo).

Steps del callback (state machine con resume tokens per gestire i redirect intermedi):
1. **Exchange `code`** per Vercel access token (Marketplace Provider API) — già in [T-A03](#t-a03-marketplace-install-callback-handler-skeleton)
2. **Supabase detection/redirect** ([T-203](#t-203-supabase-integration-detection--guided-redirect)) — se Supabase integration non installata nel team → redirect to install, resume
3. **Supabase OAuth project-claim** ([ADR-011](../decisions/ADR-011-supabase-auth-config-write-strategy.md)) — redirect a `GET /v1/oauth/authorize/project-claim` con `project_ref` del Supabase del buyer + Client ID del nostro Supabase OAuth App `save2repo`; on consent ricevi `access_token` + `refresh_token` scoped al project
4. **GitHub OAuth additional** per identità buyer + risoluzione `installation_id` GitHub App olonjs
5. **GitHub App olonjs detection/redirect** ([T-204](#t-204-github-app-olonjs-install-detection--guided-redirect)) — se installation mancante → redirect a install GitHub App, resume
6. **Fork repo `save2repo`** pubblico nel GitHub del buyer (via `POST /repos/{template}/generate` o `/forks`)
7. **Create project Vercel** nel team buyer con `gitRepository` puntato al fork
8. **Inject env vars Vercel project** del save2repo del buyer: Supabase URL/keys (read-back da Vercel project env post-Supabase auto-inject), `SAVE2REPO_DEPLOYMENT_TOKEN` (registration token T-A03), `OLONJS_API_BASE`
9. **Configura Supabase Auth del buyer via Management API** ([ADR-011](../decisions/ADR-011-supabase-auth-config-write-strategy.md)): `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` con `Authorization: Bearer <access_token>` (step 3), body:
   - `external_github_enabled: true`
   - `external_github_client_id` + `external_github_secret` = OAuth App `save2repo` GitHub credenziali centralizzate ([T-A05](#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase))
   - `site_url` = deployment URL save2repo del buyer
   - `uri_allow_list` = pattern includente deployment URL
   - **Body schema esatto da confermare empiricamente** ([T-A04 spike §Empirical follow-up](../spikes/supabase-auth-admin-spike.md#empirical-follow-up--blocking-pre-t-202)) **prima di committare T-202**
10. **Stash seed data in `save2repo_deployments`** per consumo via [T-A06](#t-a06-bootstrap-endpoint--seed-data-retrieval) al primo login del buyer: `vercel_oauth_token` (encrypted), `vercel_team_id`, `github_installation_id`, `supabase_oauth_access_token` (encrypted), `supabase_oauth_refresh_token` (encrypted), `supabase_auth_provider_configured = true`
11. **Trigger deploy** + wait READY
12. **Redirect** al deployment buyer `/welcome` ([T-206](#t-206-welcome-screen-post-install-save2repo))

**Acceptance:**
- [ ] end-to-end install da Marketplace → buyer atterra a dashboard save2repo funzionante senza settare nulla in form (consent OAuth/install esclusi: GitHub App olonjs, Supabase se mancante, primo "Continue with GitHub")
- [ ] tutti gli step ≥2 con stato persistente per gestire redirect Supabase + GitHub App
- [ ] errori intermedi propagati con context al welcome screen (T-206 + T-207)
- [ ] Supabase Auth del buyer interamente configurato programmaticamente (no Studio click manuali)
**Verification:**
- [ ] install staging integration su test team **senza Supabase pre-installato + senza GitHub App olonjs pre-installato** → completare redirect chain → verificare deploy READY + login GitHub immediato + dashboard accessibile
- [ ] `/settings/integrations` mostra Vercel "Connected" senza click manuale
**Dependencies:** T-A02, T-A03, T-A04, T-A05, T-A06, T-201, T-104
**Files:** `jsonpages-platform/src/app/api/integrations/vercel/install/route.ts` (major extension), `jsonpages-platform/src/lib/save2repoProvisioning.ts` (orchestration state machine), `jsonpages-platform/src/lib/supabaseAuthAdmin.ts` (nuova lib per le 4 scritture provider config)
**Scope:** M (orchestrazione 11 step + state machine resume; resta M ma con sub-task interni espliciti)

### T-203: Supabase integration detection + guided redirect
**Description:** nel callback handler T-202, dopo create project:
1. Check via Vercel API `GET /v1/integrations/configuration?integrationId=<supabase>` filtrato per `teamId`
2. Se installata → fetch env vars associate al project → aggancia al project save2repo via `POST /v9/projects/{id}/env`
3. Se mancante → redirect 302 a `vercel.com/integrations/supabase/new?teamId=<>&projectId=<s2r>&next=<our_callback>&state=<resume_token>`
4. Resume endpoint riprende provisioning dopo Supabase install

**Acceptance:**
- [ ] team con Supabase → env iniettate, deploy procede
- [ ] team senza Supabase → redirect Vercel; al return: provisioning completo
**Verification:**
- [ ] test E2E con team con/senza Supabase
**Dependencies:** T-202
**Files:** `jsonpages-platform/src/lib/save2repoProvisioning.ts` (extension), `jsonpages-platform/src/app/api/integrations/vercel/install/resume/route.ts`
**Scope:** M

### T-204: GitHub App olonjs install detection + guided redirect
**Description:** analogo a T-203 per GitHub App olonjs:
1. Check via GitHub API se esiste installation per il GitHub account del buyer (richiede OAuth GitHub additional step nel callback per ottenere user identity)
2. Se mancante → redirect a `https://github.com/apps/olonjs/installations/new?state=<resume_token>`
3. Resume endpoint cattura `installation_id` e popola `save2repo_deployments.github_installation_id`

**Acceptance:**
- [ ] buyer senza installation → redirect GitHub; al return: installation salvata
- [ ] buyer con installation → step skipped
**Verification:**
- [ ] test E2E
**Dependencies:** T-202, T-A01
**Files:** `jsonpages-platform/src/app/api/integrations/github/callback/route.ts`, `jsonpages-platform/src/lib/save2repoProvisioning.ts` (extension)
**Scope:** M

### T-205: Native billing endpoints
**Description:** in jsonpages-platform implementa Marketplace Billing API:
- `GET /api/integrations/vercel/products/{productId}/plans` → ritorna `[{ id: 'trial-30', label: 'Trial', cost: 0, period: { months: 1 } }, { id: 'starter', label: 'Starter', cost: 29, period: { months: 1 } }]` (TBD tier exact)
- `POST /api/integrations/vercel/installations/{installationId}/billing/usage` (no-op se tier flat)
- `POST /api/integrations/vercel/installations/{installationId}/billing/balance` (no-op se prepay)

Riferimento [vercel/example-marketplace-integration](https://github.com/vercel/example-marketplace-integration).

**Acceptance:**
- [ ] endpoints rispondono secondo Marketplace API spec
- [ ] dopo install: trial 30gg attivo, plan flat su DB
**Verification:**
- [ ] test E2E con fake billing event Vercel; check Vercel dashboard del test team
**Dependencies:** T-201
**Files:** `jsonpages-platform/src/app/api/integrations/vercel/products/[productId]/plans/route.ts`, `installations/[id]/billing/usage/route.ts`, `billing/balance/route.ts`, `src/lib/marketplaceBilling.ts`
**Scope:** M

### T-206: Welcome screen post-install (save2repo)
**Description:** pagina `/welcome` nel save2repo deployato che il callback redirige come `next`; checklist visibile: Supabase ✅, GitHub App ✅, Deployment ✅, Subscription ✅ (trial 30gg attivo); CTA "Go to dashboard".
**Acceptance:**
- [ ] tutti i check ✅ se setup completo
- [ ] eventuali ❌ con link risolutivo
**Verification:**
- [ ] manual E2E install end-to-end
**Dependencies:** T-202, T-102
**Files:** `src/app/welcome/page.tsx`
**Scope:** S

### T-207: Telemetria install funnel + error recovery
**Description:** in jsonpages-platform: log step-by-step nel callback (correlationId, step name, duration, exit). In save2repo welcome: error UI con context + retry button (`POST /api/integrations/vercel/install/retry?deploymentId=<>`).
**Acceptance:**
- [ ] log strutturati per ogni step del callback
- [ ] failure di un step → UI chiara con messaggio specifico + retry CTA
**Verification:**
- [ ] simulare failure (es. fork GitHub rate limit) e verificare UX
**Dependencies:** T-202, T-206
**Files:** `jsonpages-platform/src/lib/save2repoProvisioning.ts` (logging), `save2repo/src/app/welcome/page.tsx` (error states), `jsonpages-platform/src/app/api/integrations/vercel/install/retry/route.ts`
**Scope:** S

### Checkpoint Phase 2
- [ ] E2E staging: install da Marketplace test integration → save2repo live in <10 min, senza intervento (success criterion ADR-003)
- [ ] Billing test team: trial 30gg attivo, fattura schedulata
- [ ] Failure recovery testato (almeno 1 scenario fallito → retry funziona)
- [ ] **spike completato:** programmatic install Supabase/GitHub feasibility documentata
- [ ] **review con utente prima di Phase 3**

---

## Phase 3 — Marketplace submission & approval

### T-301: Listing materials
**Description:** asset per il Marketplace listing:
- Logo 1:1 ≥256px PNG non-transparent
- 1-5 screenshot 3:2 1440×960 (dashboard, editor, MCP demo, install funnel, custom domain)
- Tagline ≤40 char
- Overview ≤768 char (markdown supportato)
- Optional video link

**Acceptance:**
- [ ] tutti gli asset rispettano le spec Vercel
- [ ] review interna stylistic
**Verification:**
- [ ] upload nel Vercel Console + preview
**Dependencies:** None (parallelo a Phase 2)
**Files:** `docs/marketing/listing/` (asset dir)
**Scope:** M

### T-302: EULA BUSL 1.1 finalizzata
**Description:** legal review del wording BUSL: Additional Use Grant (agenzie ok), Use Limitation (no rivendita SaaS), Change Date 4y, Change License Apache 2.0. Pubblica come URL stabile.
**Acceptance:**
- [ ] LICENSE file aggiornato con wording final
- [ ] URL EULA pubblica live (es. `https://save2repo.olon.it/eula`)
**Verification:**
- [ ] link accessibile + render markdown
**Dependencies:** T-002, T-301 (per coordinare con landing pubblica)
**Files:** `save2repo/LICENSE`, public site EULA page
**Scope:** S

### T-303: Privacy Policy + Support URL
**Description:** pagine pubbliche per Privacy Policy + Support contact (email + status page link).
**Acceptance:**
- [ ] URL live + accessibili
**Verification:**
- [ ] HTTP 200 entrambi
**Dependencies:** None
**Files:** public site privacy + support pages
**Scope:** S

### T-304: Vercel approval checklist completata
**Description:** review della [approval checklist](https://vercel.com/docs/integrations/create-integration/approval-checklist); risolvere ogni voce non passata; smoke test final install da Marketplace draft.
**Acceptance:**
- [ ] tutti i criteri della checklist marcati ✅
**Verification:**
- [ ] internal go/no-go review
**Dependencies:** T-201 → T-207, T-301, T-302, T-303
**Files:** nessuno (verifiche su asset + config)
**Scope:** M

### T-305: Submission email
**Description:** email a `integrations@vercel.com` con: link integration + listing + EULA + privacy + support + 1-2 esterni invitati per smoke test.
**Acceptance:**
- [ ] email inviata
- [ ] risposta Vercel ricevuta + ticket aperto
**Verification:**
- [ ] tracciare ticket fino ad approval
**Dependencies:** T-304
**Files:** nessuno
**Scope:** XS

### Checkpoint Phase 3
- [ ] Listing pubblico vivo su `vercel.com/integrations/save2repo`
- [ ] Test install end-to-end da Marketplace pubblico (interno + 2 esterni invitati)
- [ ] **PRODUCT LIVE**

---

## Sommario sizing

| Phase | XS | S | M | Total |
|---|---|---|---|---|
| Phase 0 | 1 | 2 | 5 | 8 |
| Phase A | 0 | 3 | 3 | 6 |
| Phase 1 | 0 | 4 | 8 | 12 |
| Phase 2 | 0 | 2 | 5 | 7 |
| Phase 3 | 1 | 2 | 2 | 5 |
| **TOT** | **2** | **13** | **23** | **38** |

(Conteggio 38 incluso checkpoint formali; task effettivi 34. T-102.b cancellato — assorbito in T-202. T-103 ridotto da M a S — happy path auto-popolato via T-A06. T-A05 allargato da XS a S — copre 2 OAuth App, GitHub + Supabase, per ADR-011.)

## Verification pre-implementation (skill checklist)
- [x] Ogni task ha acceptance criteria
- [x] Ogni task ha verification step
- [x] Dipendenze identificate e ordine rispettato
- [x] Nessun task tocca >5 file (eccetto T-003 / T-004 di pulizia, che sono per natura wide)
- [x] Checkpoint esistono tra ogni Phase
- [ ] **Review dell'utente prima di iniziare implementation**
