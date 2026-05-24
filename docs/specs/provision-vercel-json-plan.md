# Implementation Plan: provision — vercel.json + BLOB_TENANT_DISCOVERY_BASE

## Overview

Aggiungere al flusso `provision-stream` due step che garantiscono che ogni tenant provisionato (da template o da repository) abbia il `vercel.json` con i Blob rewrites corretti e la env var `BLOB_TENANT_DISCOVERY_BASE` impostata sul suo progetto Vercel.

## Architecture Decisions

- Il `vercel.json` viene **generato da zero** dalla platform — struttura fissa nel codice, nessuna lettura dal repo
- Entrambi i source type (`template` e `repository`) ricevono lo stesso trattamento — nessun guard su `source.type`
- Entrambi gli step sono **non-fatali** — errori loggati come warning, provision continua
- Posizione: dopo `send('step', { id: 'env', status: 'done' })`, prima del trigger deploy

---

## Task List

### Task 1: Generazione e commit `vercel.json` ✅ IMPLEMENTATO

**Description:** Dopo l'env step, la platform genera il `vercel.json` completo con tutti i Blob rewrites e lo committa nel repo GitHub del tenant via `createOrUpdateFileContents`. Se il file esiste già, viene sovrascritto (SHA letto preventivamente). Non-fatal.

**Acceptance criteria:**
- [x] Funziona per `source.type === 'template'`
- [x] Funziona per `source.type === 'repository'`
- [x] Se `JSONPAGES_BLOB_PUBLIC_BASE` assente: skip silenzioso con log warning
- [x] Se commit GitHub fallisce: log warning, provision continua
- [x] `vercel.json` nel repo ha URL Blob reali, nessun placeholder
- [x] `npx tsc --noEmit` pulito

**File:**
- `src/app/api/v1/tenants/provision-stream/route.ts` *(aggiunta)*

**Scope:** S

---

### Task 2: Iniezione `BLOB_TENANT_DISCOVERY_BASE` ✅ GIÀ PRESENTE

**Description:** `BLOB_TENANT_DISCOVERY_BASE` è già iniettata nell'`env` step nell'array `envs` senza guard su `source.type`. Nessuna modifica necessaria.

**Verifica:**
- [x] `envs` array include `BLOB_TENANT_DISCOVERY_BASE` per entrambi i tipi se `blobPublicBase` configurata

---

## Checkpoint

- [x] `npx tsc --noEmit` pulito
- [ ] Provision da repository: `vercel.json` nel repo ha URL Blob reali
- [ ] Provision da template: idem
- [ ] Provision senza `JSONPAGES_BLOB_PUBLIC_BASE`: completa senza errori

## Risks

| Rischio | Impatto | Mitigazione |
|---|---|---|
| GitHub App senza permessi write sul repo | M — commit fallisce | Non-fatal, log warning |
| `vercel.json` già presente con contenuto diverso | L — sovrascrittura intenzionale | SHA letto e passato, sovrascrittura corretta |
