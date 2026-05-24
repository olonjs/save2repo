# Implementation Plan: Admin keypair — at-rest encryption + provision auto-setup

## Overview
Due interventi sequenziali sulla colonna `tenants.admin_private_key`:

1. Cifra trasparente con `pgsodium` (lato Supabase), nessun cambio applicativo se non un puntamento alla vista `decrypted_tenants` in lettura.
2. Auto-generazione del keypair durante il provision di un nuovo tenant, con propagazione automatica della public key come env `ADMIN_PUBLIC_KEY` sul Vercel project del tenant via Vercel API.

`Regenerate Keypair` manuale resta invariato.

## Architecture Decisions
- **pgsodium con security label** (non Vault/KMS): minima frizione, master key gestita da Supabase, zero codice crypto applicativo.
- **Lettura via vista `decrypted_tenants`** auto-generata: nessuna chiamata `crypto_aead_*` esplicita nel codice.
- **Provision auto-setup best-effort**: se la chiamata Vercel API set env fallisce, il provision NON viene bloccato. La privata è già salvata; l'utente vedrà la public key nel pannello Admin Access e potrà ri-pushare a mano.
- **Regenerate manuale invariato**: nessuna modifica al flow `admin-keypair` endpoint o al bottone UI.

## Dependency Graph
```
Slice 1 (migration pgsodium)
   │
   ├── Slice 2 (admin-token leggi da decrypted_tenants)
   │
   └── Slice 3 (helper vercelProjectEnv)
           │
           └── Slice 4 (provision auto-setup)
```

## Task List

### Phase 1: Encryption a riposo

#### Task 1: Migration pgsodium su `admin_private_key` + backfill
**Description:** Crea master key pgsodium, applica security label sulla colonna `admin_private_key`, ri-scrive le righe esistenti per cifrarle. Idempotente.
**Acceptance:**
- [ ] Migration con timestamp corretto in `supabase/migrations/`
- [ ] `pgsodium.create_key(name => 'tenants_admin_private_key')` idempotente
- [ ] `security label ... ENCRYPT WITH KEY NAME tenants_admin_private_key`
- [ ] `UPDATE tenants SET admin_private_key = admin_private_key WHERE admin_private_key IS NOT NULL` (force re-write)
**Verification:** dopo apply migration, `select admin_private_key from tenants limit 1` mostra ciphertext; `select decrypted_admin_private_key from decrypted_tenants limit 1` mostra PEM in chiaro.
**Dependencies:** None
**Files:** `supabase/migrations/<ts>_admin_private_key_encrypted.sql`
**Scope:** S

#### Task 2: Lettura admin-token via `decrypted_tenants`
**Description:** Modifica `admin-token/route.ts` per leggere `decrypted_admin_private_key` dalla vista. Nessun altro cambio.
**Acceptance:**
- [ ] `from('tenants').select('admin_private_key, ...')` → `from('decrypted_tenants').select('decrypted_admin_private_key, ...')`
- [ ] `buildJwt(tenant.decrypted_admin_private_key)`
- [ ] Compatibile con tenant pre-migration (ora cifrati) e nuovi (cifrati automatic)
**Verification:** `npm run build`; manual smoke: click "Admin" su un tenant migrato → arriva su `/admin` Studio.
**Dependencies:** Task 1
**Files:** `src/app/api/v1/tenants/[id]/admin-token/route.ts`
**Scope:** XS

### Checkpoint: Encryption
- [ ] Build pulita
- [ ] Migration applicata su Supabase
- [ ] Click "Admin" funziona su 1 tenant pre-esistente

---

### Phase 2: Provision auto-setup

#### Task 3: Helper `vercelProjectEnv.ts`
**Description:** Nuovo helper che chiama `POST /v10/projects/{projectId}/env` su Vercel API per settare/aggiornare una env var. Retry/backoff allineato a `vercelDomains.ts`. Tollerante a 409 (env già esistente) → in MVP trattata come no-op success.
**Acceptance:**
- [ ] Funzione `setProjectEnv({ projectId, key, value, target, type })` esportata
- [ ] Retry su 429/5xx con backoff esponenziale
- [ ] 409 (`ENV_ALREADY_EXISTS`) loggato e ritornato come `{ alreadyExists: true }`, NON come errore
- [ ] Usa `VERCEL_AUTH_TOKEN` + `VERCEL_TEAM_ID` da env
**Verification:** `npm run build`; smoke isolato con un projectId test.
**Dependencies:** None
**Files:** `src/lib/vercelProjectEnv.ts`
**Scope:** S

#### Task 4: Provision step — generate keypair + UPDATE + set env Vercel
**Description:** Estendi `provision-stream/route.ts`: dopo la creazione del Vercel project e PRIMA del trigger del primo deploy, genera EC P-256 keypair, salva privata (cifrata automatic da pgsodium), chiama `setProjectEnv` per `ADMIN_PUBLIC_KEY`. Errori env Vercel → loggati come step warning, NON bloccano il provision.
**Acceptance:**
- [ ] Step "admin-keypair-bootstrap" eseguito dopo creazione progetto Vercel, prima del deploy
- [ ] `tenants.admin_private_key` valorizzato col PEM (poi cifrato in colonna)
- [ ] Env `ADMIN_PUBLIC_KEY` settata su Vercel project con target=[production, preview], type=encrypted
- [ ] Fallimento Vercel API non blocca il provision (warning nello stream output)
- [ ] Skip se `admin_private_key` è già valorizzato (idempotenza su re-provision)
**Verification:** Crea un tenant nuovo end-to-end; verifica su Vercel dashboard che la env è presente prima del deploy; verifica nel DB che la priv è cifrata; UI mostra "Configured" subito.
**Dependencies:** Task 1, Task 3
**Files:** `src/app/api/v1/tenants/provision-stream/route.ts`
**Scope:** M

### Checkpoint: Provision auto-setup
- [ ] Nuovo tenant ha env `ADMIN_PUBLIC_KEY` settata prima del primo deploy
- [ ] Dashboard mostra Admin Access = Configured senza click utente
- [ ] Regenerate Keypair manuale invariato

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `pgsodium` non abilitato sul progetto Supabase | High (migration fallisce) | Verifica prima dell'apply: `select * from pg_extension where extname='pgsodium'`. Se mancante, `create extension pgsodium`. |
| Backfill blocca per dimensione tabella | Low (poche righe attese) | Update lineare; in caso di centinaia di migliaia, batch per tenant_id |
| Vercel API rate limit durante provision burst | Med | Retry/backoff già nel helper; cap su provision simultanei è già nel sistema esistente |
| Set env Vercel fallisce silente | Med (admin access non funziona dopo deploy) | Warning step visibile nello stream; bottone "Re-push" futuro se osservato in prod |

## Open Questions
- `pgsodium` attivo su tutti gli env Supabase (prod, preview, dev)?
- C'è già un meccanismo di rollback per le migration applicate? (Se no, la migration di Task 1 è additiva e backward-compatible — sicura da applicare.)
