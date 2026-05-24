# ADR-002: Per-Tenant EC Keypair Management and Server-Side JWT Signing

## Status
Accepted — Supersedes ADR-001

## Date
2026-05-13

## Context
ADR-001 gestiva l'accesso admin con un token statico (PSK) salvato in
`tenants.admin_token`. La platform lo inviava direttamente come query param.
Il modello PSK è stato abbandonato in favore di crittografia asimmetrica per-tenant
(vedi ADR-006 in `tenant-alpha`).

La platform è il custode delle chiavi private dei tenant. Deve:
1. Generare keypair EC P-256 per ogni tenant
2. Esporre la chiave pubblica all'operatore (per configurarla su Vercel)
3. Firmare JWT ES256 a breve scadenza quando l'operatore vuole aprire lo Studio
4. Non esporre mai la chiave privata al browser

## Decision

### DB Schema
- Colonna `tenants.admin_private_key text` (sostituisce `admin_token`)
- Memorizza la private key in formato PEM (`-----BEGIN EC PRIVATE KEY-----`)
- Nullable: tenant senza keypair non possono accedere all'admin dalla platform

### Generazione keypair (Settings tab)
La card "Admin Access" nel tab Settings espone un bottone **"Generate Keypair"** che:
1. Chiama `POST /api/v1/tenants/:id/admin-keypair/generate` (server-side)
2. Il server genera una coppia EC P-256 via Node.js `crypto.generateKeyPairSync`
   (o Web Crypto nell'Edge Runtime)
3. Salva la **private key** (PEM) in `tenants.admin_private_key`
4. Restituisce solo la **public key** (PEM) al browser
5. La UI mostra la public key in un textarea read-only con bottone "Copy"
6. L'operatore incolla la public key come env var `ADMIN_PUBLIC_KEY` sul progetto
   Vercel del tenant e rideploya

La private key non viene mai restituita al browser — il server la salva direttamente.

### Firma JWT (Overview tab — bottone Admin)
Quando l'operatore clicca "Admin":
1. Il browser chiama `POST /api/v1/tenants/:id/admin-token`
   con `Authorization: Bearer <supabase_session_token>`
2. Il server:
   a. Verifica l'identità dell'operatore (Supabase auth + ownership check)
   b. Legge `admin_private_key` da Supabase
   c. Firma un JWT ES256: `{ alg: "ES256", typ: "JWT" }` /
      `{ sub: "admin-access", iat: now, exp: now + 300 }`
   d. Restituisce `{ token: "<jwt>", adminUrl: "<tenantPublicUrl>/admin" }`
3. Il browser apre `<adminUrl>?token=<jwt>` in una nuova tab

La private key esegue operazioni crittografiche solo nel contesto server —
mai serializzata nel response body.

### Auth sull'endpoint
Entrambi gli endpoint (`generate` e `admin-token`) passano da
`resolveRequestUser` + `assertTenantAccess` (role check owner) — coerente con tutti
gli altri endpoint mutanti della platform.

## Alternatives Considered

### Generazione keypair lato browser (Web Crypto)
- Pro: zero server round-trip
- Contro: la private key passerebbe dal browser al server per essere salvata —
  esposta in rete anche su HTTPS; peggiora il threat model
- Rifiutato: la private key non deve mai transitare nel browser

### Keypair globale platform (una chiave per tutti i tenant)
- Pro: zero gestione, una sola chiave da ruotare
- Contro: nessun isolamento per-tenant; compromissione della chiave platform
  compromette TUTTI i tenant simultaneamente
- Rifiutato: requisito esplicito di isolamento per-tenant

### Memorizzare la private key cifrata (AES-GCM) in Supabase
- Pro: chiave a riposo cifrata anche se il DB viene esfiltrato
- Contro: la chiave di cifratura deve stare da qualche parte (env var platform);
  aggiunge complessità senza benefici sostanziali se il DB e la platform
  sono sulla stessa infrastruttura trust boundary
- Rimandato: può essere aggiunto in v2 se i requisiti di compliance lo richiedono

### Usare Vercel API per iniettare `ADMIN_PUBLIC_KEY` automaticamente
- Pro: zero operazione manuale
- Contro: richiede Vercel API token con scope env vars; aggiunge surface di
  attacco sulla platform; il redeploy automatico è invasivo
- Rimandato: candidato per v2 (automation path)

## Consequences
- Aggiunta colonna `admin_private_key` su `tenants` (migration separata da
  `admin_token` già applicata — vedi migration `20260513180000`)
- La card Settings ora mostra: stato keypair (configurata/non configurata),
  bottone "Generate Keypair", public key da copiare, warning se non configurata
- Il bottone "Admin" in Overview ora fa un fetch server-side prima di aprire la tab
- L'operatore deve fare un passo manuale: copiare la public key su Vercel + redeploy
- La rotazione del keypair richiede: rigenera (new private key in DB) + aggiorna
  env var Vercel + redeploy tenant
- I JWT emessi con la vecchia chiave diventano invalidi immediatamente dopo il
  redeploy (5 min max di overlap se il tenant non è stato ancora ridepployato)

## See Also
- ADR-001 (superseded) — approccio PSK precedente
- ADR-006 in `npm-jpcore/apps/tenant-alpha` — verifica JWT nel middleware tenant
