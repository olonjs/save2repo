# Implementation Plan: Cloudflare-native domain management

## Overview
Estendiamo il tab Domains con un layer Cloudflare: bootstrap automatico di una zona CF all'aggiunta di un dominio, polling stato NS, UI di gestione DNS records con toggle proxy. Vercel rimane intoccato. Implementazione vertical slicing in 4 fasi, ognuna con un valore utente atomico.

## Architecture Decisions
- **CF è strato additivo, mai sostitutivo**: nessuna modifica al flow Vercel esistente
- **Live read da CF API per record DNS**: niente cache in DB (decisione utente)
- **Polling, non webhook**: webhook zone events richiede Enterprise; usiamo il pattern reconcile esistente
- **Schema additivo su `tenant_domains`**: nessuna tabella nuova
- **Pattern auth/correlation/idempotency riusati**: stesso shape di `src/lib/vercelDomains.ts` e `src/app/api/v1/tenants/[id]/domains/route.ts`
- **REST diretto via `fetch`**: nessun SDK Cloudflare aggiunto a deps

## Decision Gate (Phase 0)
Queste decisioni bloccano alcune task. Vanno risolte PRIMA di iniziare la Phase corrispondente:

| OQ | Decisione | Blocca Phase |
|----|-----------|--------------|
| OQ-1 | Trigger CF bootstrap (auto al POST `/domains` vs azione esplicita) | Phase 2 |
| OQ-2 | Disconnect CF in MVP (sì/no, semantica cancella vs unlink) | Phase 4 |
| OQ-3 | Default proxy state per nuovi record A/AAAA/CNAME | Phase 3 (Task 9) |
| OQ-4 | Tipi DNS editabili in MVP (subset vs tutti) | Phase 3 (Task 8) |
| OQ-5 | Record Vercel (apex/www) read-only o editabili | Phase 3 (Task 9) |
| OQ-6 | Conflitto zona pre-esistente: error vs reuse | Phase 2 (Task 4) |
| OQ-7 | Schema preciso campi `tenant_domains` | Phase 1 (Task 2) — proposta sotto, da approvare |

**Proposta OQ-7** (per sbloccare Phase 1):
```sql
alter table public.tenant_domains
  add column if not exists cf_zone_id text,
  add column if not exists cf_nameservers jsonb,            -- array di stringhe
  add column if not exists cf_status text,                  -- 'pending_ns' | 'active' | 'error' | 'disconnected'
  add column if not exists cf_zone_status_checked_at timestamptz,
  add column if not exists cf_attached_at timestamptz,
  add column if not exists cf_last_error_code text,
  add column if not exists cf_last_error_message text;

create index if not exists tenant_domains_cf_status_idx
  on public.tenant_domains (cf_status)
  where cf_status is not null and deleted_at is null;
```

## Task List

### Phase 1: Foundation (sblocco: OQ-7)

#### Task 1: ENV vars CF + token validation helper
**Description:** Aggiungere `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` a `.env.example` e creare un helper `resolveCloudflareCredentials()` in `src/lib/cloudflareApi.ts` (stub) che validi presenza/format del token e fallisca con errore chiaro.
**Acceptance:**
- [ ] `.env.example` aggiornato
- [ ] Helper `resolveCloudflareCredentials()` esportato, lancia se le env mancano
**Verification:** `npm run build` passa; unit-call dell'helper in node REPL con/senza env
**Dependencies:** None
**Files:** `.env.example`, `src/lib/cloudflareApi.ts` (nuovo, stub)
**Scope:** XS

#### Task 2: Schema migration `tenant_domains` CF fields
**Description:** Nuova migration SQL che aggiunge i campi `cf_*` alla tabella `tenant_domains` come da proposta OQ-7.
**Acceptance:**
- [ ] Migration file con timestamp corretto in `supabase/migrations/`
- [ ] Idempotente (`add column if not exists`)
- [ ] Indice condizionale su `cf_status`
**Verification:** `npx supabase db reset` (locale) o equivalente; `\d public.tenant_domains` mostra i nuovi campi
**Dependencies:** OQ-7 approvato
**Files:** `supabase/migrations/<ts>_tenant_domains_cloudflare.sql`
**Scope:** S

#### Task 3: `cloudflareApi.ts` wrapper completo
**Description:** Implementare il wrapper API CF v4 con le funzioni necessarie: `createZone`, `getZone`, `deleteZone`, `listDnsRecords`, `createDnsRecord`, `updateDnsRecord`, `deleteDnsRecord`. Retry/backoff su 429/5xx come fa `vercelDomains.ts`. Error mapping → `CloudflareApiError` con codes `ERR_CF_*`.
**Acceptance:**
- [ ] Funzioni esportate con tipi Zod-validated input/output
- [ ] Retry su 429/5xx con backoff esponenziale
- [ ] Error mapping con codes prefix `ERR_CF_*`
- [ ] Nessuna chiamata di rete in import-time
**Verification:** `npm run build` + smoke test isolato con token reale (script ad hoc)
**Dependencies:** Task 1
**Files:** `src/lib/cloudflareApi.ts`
**Scope:** M

### Checkpoint: Foundation
- [ ] Build pulita
- [ ] Migration applicata
- [ ] Helper CF chiama API reale senza errori (smoke con 1 GET zones)

---

### Phase 2: CF bootstrap + status polling (sblocco: OQ-1, OQ-6)

#### Task 4: POST `cf-bootstrap` endpoint
**Description:** Endpoint che, per un dominio esistente nel tenant, crea la zona CF, salva `cf_zone_id` + `cf_nameservers` + `cf_status = 'pending_ns'` su `tenant_domains`. Registra evento `cf_bootstrap` in `tenant_domain_events`. Idempotency via `Idempotency-Key` header.
**Acceptance:**
- [ ] `POST /api/v1/tenants/[id]/domains/[domain]/cf-bootstrap`
- [ ] Auth + governance + rate-limit riusati
- [ ] Idempotency: stesso key → replay payload
- [ ] Conflitto zona pre-esistente gestito secondo OQ-6
- [ ] Risponde `{ cf_zone_id, name_servers[], cf_status }`
**Verification:** Manual via curl; verifica record DB; verifica zona creata su CF dashboard
**Dependencies:** Task 3, OQ-1, OQ-6
**Files:** `src/app/api/v1/tenants/[id]/domains/[domain]/cf-bootstrap/route.ts`
**Scope:** M

#### Task 5: Estensione reconcile per `cf_status = pending_ns → active`
**Description:** Estendere `src/app/api/v1/internal/domains/reconcile/route.ts` per scansionare domini con `cf_status = 'pending_ns'`, chiamare `getZone(cf_zone_id)`, e quando CF risponde `status = 'active'` aggiornare a `cf_status = 'active'` + `cf_attached_at = now()`.
**Acceptance:**
- [ ] Reconcile rileva delegation completata
- [ ] Transizione `pending_ns → active` persistita
- [ ] Eventi audit aggiunti
- [ ] Errori CF salvati in `cf_last_error_*`
**Verification:** Test manuale con dominio reale dopo cambio NS; query DB
**Dependencies:** Task 4
**Files:** `src/app/api/v1/internal/domains/reconcile/route.ts`
**Scope:** S

#### Task 6: UI tab Domains — pannello NS + status CF
**Description:** Nel componente `src/app/dashboard/components/domains/`, per ogni dominio del tenant mostrare un pannello con `cf_status`, lista NS da impostare con copy-button, e indicatore stato (pending / active).
**Acceptance:**
- [ ] Pannello visibile sotto ogni riga dominio
- [ ] NS copiabili con click
- [ ] Indicatore visivo `pending_ns` vs `active`
- [ ] Refresh manuale dello status
**Verification:** Manual UI test in dev con tenant fittizio + dominio test
**Dependencies:** Task 4, Task 5
**Files:** 2-3 file in `src/app/dashboard/components/domains/`
**Scope:** M

### Checkpoint: Bootstrap funzionante
- [ ] Tenant può aggiungere dominio → vede NS → cambia al registrar → status diventa `active`
- [ ] End-to-end con 1 dominio reale

---

### Phase 3: DNS records management (sblocco: OQ-3, OQ-4, OQ-5)

#### Task 7: GET `dns` — list records
**Description:** Endpoint che lista i record DNS della zona CF live (no cache DB). Filtra per tipi editabili secondo OQ-4.
**Acceptance:**
- [ ] `GET /api/v1/tenants/[id]/domains/[domain]/dns`
- [ ] Risponde con array record CF (id, type, name, content, ttl, proxied)
- [ ] Errore se `cf_status !== 'active'`
- [ ] Auth + access check
**Verification:** Curl reale; confronto con dashboard CF
**Dependencies:** Task 3, Task 5, OQ-4
**Files:** `src/app/api/v1/tenants/[id]/domains/[domain]/dns/route.ts` (GET)
**Scope:** S

#### Task 8: POST `dns` — create record
**Description:** Endpoint create record DNS. Default proxy state secondo OQ-3 per record A/AAAA/CNAME.
**Acceptance:**
- [ ] `POST /api/v1/tenants/[id]/domains/[domain]/dns`
- [ ] Input Zod-validated (type, name, content, ttl, proxied)
- [ ] Tipi accettati = subset OQ-4
- [ ] Idempotency-Key supportato
- [ ] Evento audit `cf_dns_record_create`
**Verification:** Curl crea record; visibile su CF dashboard
**Dependencies:** Task 7, OQ-3, OQ-4
**Files:** stesso route file (POST handler)
**Scope:** S

#### Task 9: PATCH `dns/[recordId]` — update record + proxy toggle
**Description:** Update di un record DNS incluso il flip `proxied`. Se OQ-5 = read-only-managed, bloccare PATCH su record che puntano a Vercel (apex/www).
**Acceptance:**
- [ ] `PATCH /api/v1/tenants/[id]/domains/[domain]/dns/[recordId]`
- [ ] Toggle `proxied: true|false` persiste
- [ ] Se record è platform-managed (OQ-5), errore `ERR_CF_RECORD_LOCKED`
- [ ] Evento audit
**Verification:** Curl flip orange/grey; verifica dashboard CF
**Dependencies:** Task 8, OQ-5
**Files:** `src/app/api/v1/tenants/[id]/domains/[domain]/dns/[recordId]/route.ts` (PATCH)
**Scope:** S

#### Task 10: DELETE `dns/[recordId]` — remove record
**Description:** Delete di un record DNS. Stesso vincolo platform-managed se OQ-5.
**Acceptance:**
- [ ] `DELETE /api/v1/tenants/[id]/domains/[domain]/dns/[recordId]`
- [ ] Record rimosso da CF
- [ ] Evento audit
**Verification:** Curl + dashboard CF
**Dependencies:** Task 9
**Files:** stesso file (DELETE handler)
**Scope:** S

#### Task 11: UI — tabella DNS records + form add/edit
**Description:** Componente tabella DNS (visibile solo se `cf_status = active`) con righe per record, toggle proxy inline, bottoni edit/delete, modale per create/edit. Stile dashboard CF.
**Acceptance:**
- [ ] Tabella renderizza tutti i record da GET
- [ ] Toggle proxy inline funzionante (PATCH)
- [ ] Modale create con form Zod-validated
- [ ] Modale edit con prefill
- [ ] Delete con confirmation
- [ ] Record platform-managed mostrati con badge + lock
**Verification:** Manual E2E nel dashboard
**Dependencies:** Task 7-10
**Files:** 3-5 file in `src/app/dashboard/components/domains/dns/` (nuovo subdir)
**Scope:** L → considera split se diventa troppo grosso

### Checkpoint: DNS management funzionante
- [ ] CRUD record dalla UI funziona end-to-end
- [ ] Proxy toggle visibile e persistente
- [ ] Build + lint puliti

---

### Phase 4: Lifecycle cleanup (sblocco: OQ-2)

#### Task 12: Cleanup zona CF nel `DELETE /tenants/[id]`
**Description:** Estendere `src/lib/tenantDeletion.ts` con `deleteTenantCloudflareZones(tenantId)` che cancella tutte le zone CF associate ai domini del tenant. Chiamare prima della cancellazione blob nel route DELETE tenant.
**Acceptance:**
- [ ] Funzione `deleteTenantCloudflareZones` esportata
- [ ] Loop sui domini del tenant con `cf_zone_id` non null
- [ ] Tollerante a 404 CF (zona già cancellata)
- [ ] Errore registrato in `tenant_delete_events` se fallisce
**Verification:** Test delete tenant manuale; verifica zona sparisce da CF dashboard
**Dependencies:** Task 3
**Files:** `src/lib/tenantDeletion.ts`, `src/app/api/v1/tenants/[id]/route.ts`
**Scope:** S

#### Task 13: Disconnect CF endpoint (CONDIZIONALE — solo se OQ-2 = "MVP")
**Description:** Endpoint per disconnettere CF da un dominio. Semantica secondo OQ-2: cancella zona o solo unlink.
**Acceptance:**
- [ ] `POST /api/v1/tenants/[id]/domains/[domain]/cf-disconnect`
- [ ] Esegue azione secondo OQ-2
- [ ] `cf_status → 'disconnected'`
**Verification:** Curl + verifica stato DB e CF
**Dependencies:** OQ-2
**Files:** `src/app/api/v1/tenants/[id]/domains/[domain]/cf-disconnect/route.ts`
**Scope:** S

### Checkpoint: Lifecycle
- [ ] Delete tenant cancella le zone CF
- [ ] (Se OQ-2 = MVP) Disconnect funziona

---

### Phase 5: Test E2E + Docs

#### Task 14: Integration test script `cf-domains-test.mjs`
**Description:** Nuovo script che esegue il flow completo: bootstrap → poll status → CRUD record → proxy toggle → cleanup. Env-gated come gli altri test del repo.
**Acceptance:**
- [ ] `npm run test:domains:cf` esiste e passa con env reali
- [ ] Skipped quando env non presenti
- [ ] Logging chiaro di ogni step
**Verification:** Run script su account/dominio test
**Dependencies:** Tutte le precedenti
**Files:** `scripts/cf-domains-test.mjs`, `package.json` (nuovo script)
**Scope:** M

### Checkpoint finale
- [ ] Tutti i Success Criteria della spec verificati
- [ ] Build + lint puliti
- [ ] Test E2E passa
- [ ] Vercel domain flow inalterato (test esistenti `test:domains` passano ancora)
- [ ] Review umana prima di merge

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Auto-import zona CF perde record (es. MX) | Alto (rottura email cliente) | Test con domini reali con DNS complesso; warning UX al cliente prima del cambio NS |
| Cliente non cambia NS mai → zone CF orfane | Medio (clutter account, no costo) | TTL su `pending_ns`: dopo N giorni, prompt al cliente o cleanup automatico (decisione product) |
| Vercel blocca/throttla traffico via CF | Alto (sito down) | Test pilota end-to-end prima di rilascio; rollback = grey cloud su tutti i record |
| Rate limit CF API durante reconcile massivo | Medio | Retry/backoff già nel wrapper; batching del polling |
| Idempotency replay race in cf-bootstrap | Basso | Stesso pattern di `tenant_delete_events` (constraint unique) |

## Open Questions
Stesse della spec, riportate qui per visibilità. Risolvere le OQ marcate come bloccanti prima di iniziare la phase corrispondente.

## Parallelization
- Task 1 e Task 2 indipendenti, parallelizzabili
- Task 7-10 (API DNS) possono essere sviluppati in parallelo se Task 3 (wrapper) è completo
- Task 11 (UI DNS) deve attendere Task 7-10
- Task 12 indipendente da Phase 3, può partire in parallelo a Phase 3
