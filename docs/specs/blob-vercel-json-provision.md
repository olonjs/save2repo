# Implementation Plan: vercel.json Blob placeholder resolution

## Overview

Durante il provision di un tenant da template, dopo che `vercelSlug` è noto e prima del primo deploy Vercel, la platform legge il `vercel.json` dal repo appena creato, sostituisce `{BLOB_BASE}` → `JSONPAGES_BLOB_PUBLIC_BASE` e `{slug}` → `vercelSlug`, e committa il file risolto. Un solo deploy, già con i rewrites corretti.

## Architecture Decisions

- Solo per source type `template` — per source type `repository` il `vercel.json` è dell'utente, non si tocca
- Non-fatal: se fallisce, log warning e si continua (stesso pattern dello step `static_files`)
- Posizione: fine dello step `env`, prima di `send('step', { id: 'deploy', ... })`

---

## Task List

### Task 1: Resolve `vercel.json` placeholders in `provision-stream`

**Description:** Dopo aver impostato le env vars (`env` step) e prima di triggerare il primo deploy, la platform legge `vercel.json` dal repo GitHub del tenant appena creato via `octokit.rest.repos.getContent`, sostituisce i placeholder `{BLOB_BASE}` e `{slug}` con i valori reali, e committa il file aggiornato via `octokit.rest.repos.createOrUpdateFileContents`. Operazione non-fatal: errori loggati come warning, il provision continua.

**Acceptance criteria:**
- [ ] Eseguito solo se `source.type === 'template'` e `JSONPAGES_BLOB_PUBLIC_BASE` è configurata
- [ ] `vercel.json` nel repo del tenant dopo il provision non contiene più `{BLOB_BASE}` né `{slug}`
- [ ] Le destination URL nel `vercel.json` finale puntano all'URL Blob reale del tenant
- [ ] Se `vercel.json` non esiste nel repo (getContent → 404): log warning, skip, provision continua
- [ ] Se `JSONPAGES_BLOB_PUBLIC_BASE` non configurata: skip silenzioso con log warning
- [ ] Se il commit fallisce: log warning, provision continua — non si emette `error` SSE

**Verification:**
- [ ] `npx tsc --noEmit` passa
- [ ] Provision manuale di un tenant da template: `vercel.json` nel repo risultante ha URL Blob reali
- [ ] Provision manuale di un tenant da repository: `vercel.json` non viene toccato

**Dependencies:** Nessuna — modifica a un solo file

**Files:**
- `src/app/api/v1/tenants/provision-stream/route.ts` *(modifica)*

**Scope:** S

---

### Task 2: Aggiornare documentazione timing

**Description:** Correggere ADR-003, flow doc e spec per indicare il timing corretto: fine step `env`, non inizio step `repo` (dove `vercelSlug` non è ancora disponibile).

**Acceptance criteria:**
- [ ] ADR-003 indica "dopo che `vercelSlug` è noto, prima del deploy"
- [ ] `v1-tenants-provision-stream.md` indica la posizione corretta
- [ ] Spec aggiornata di conseguenza

**Dependencies:** Nessuna (parallelizzabile con Task 1)

**Files:**
- `docs/decisions/ADR-003-blob-static-discovery-files.md`
- `docs/flows/v1-tenants-provision-stream.md`
- `docs/specs/blob-static-discovery-files.md`

**Scope:** XS

---

## Checkpoint

- [ ] `npx tsc --noEmit` pulito
- [ ] `vercel.json` di un tenant provisionato da template ha URL Blob reali senza placeholder
- [ ] Un tenant provisionato da repository non ha il `vercel.json` modificato

---

## Risks

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `vercel.json` non presente nel template repo | M — skip silenzioso, tenant senza rewrites | Log warning; backfill script copre i casi mancanti |
| Template `tenant-radice` non ancora aggiornato con i placeholder | A — provision funziona ma `vercel.json` non ha i placeholder da sostituire | Non-fatal; il `replace()` non trova nulla e committa il file invariato |

## Open Question

Il template `tenant-radice` (repo GitHub `jsonpages/tenant-radice`) ha già il `vercel.json` con i placeholder `{BLOB_BASE}` e `{slug}`? Se no, va aggiornato in quel repo prima che il provision funzioni end-to-end.
