# v1-tenants-admin

Endpoint per la gestione dell'accesso admin per-tenant tramite crittografia asimmetrica EC P-256.

## Endpoint 1: `POST /api/v1/tenants/:id/admin-keypair`

### Purpose
Genera un keypair EC P-256 per il tenant. La private key viene salvata in `tenants.admin_private_key` (Supabase). La public key viene restituita all'operatore per configurarla come `ADMIN_PUBLIC_KEY` env var sul progetto Vercel del tenant.

### Trigger / Caller
Dashboard platform — card "Admin Access" nel tab Settings, bottone "Generate Keypair".

### Auth
- `Authorization: Bearer <supabase_session_token>`
- `requireRequestUser` + `assertTenantAccess` (requiredRole: `admin`)
- `X-Correlation-Id` header (opzionale, auto-generato se assente)

### Request Contract
```
POST /api/v1/tenants/:id/admin-keypair
Authorization: Bearer <token>
X-Correlation-Id: <uuid>
```
Body: vuoto.

### State Machine Effects
- `tenants.admin_private_key` viene sovrascritto con la nuova private key PEM (PKCS#8)
- Qualsiasi JWT firmato con la vecchia chiave diventa automaticamente invalido (il middleware verifica con la public key su Vercel, che viene aggiornata dall'operatore dopo la generazione)

### External Dependencies
- `crypto.generateKeyPairSync` (Node.js runtime) — nessuna dipendenza esterna
- Supabase `getSupabaseAdmin()` per update `tenants`

### Response Contract
```json
// 201 Created
{
  "correlationId": "uuid",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkwE...\n-----END PUBLIC KEY-----\n"
}

// 401 — auth fallita
// 403 — accesso tenant negato
// 500 — generazione o salvataggio fallito
{ "error": "...", "code": "ERR_ADMIN_KEYPAIR_GENERATE_FAILED", "correlationId": "uuid" }
```

### Failure Modes & Recovery
| Scenario | Comportamento |
|---|---|
| `crypto.generateKeyPairSync` fallisce | 500 con `ERR_ADMIN_KEYPAIR_GENERATE_FAILED` |
| Supabase update fallisce | 500; keypair generato ma non salvato — ripetere la chiamata |
| Tenant non trovato / accesso negato | 403 |

---

## Endpoint 2: `POST /api/v1/tenants/:id/admin-token`

### Purpose
Emette un JWT ES256 firmato con la private key del tenant (exp: 5 minuti). Il token viene usato dalla platform per aprire `<tenantUrl>/admin?token=<jwt>`. Il middleware Edge sul tenant verifica la firma con `ADMIN_PUBLIC_KEY` e imposta un session cookie (1h).

### Trigger / Caller
Dashboard platform — bottone "Admin" nel tab Overview.

### Auth
- `Authorization: Bearer <supabase_session_token>`
- `requireRequestUser` + `assertTenantAccess` (requiredRole: `admin`)

### Request Contract
```
POST /api/v1/tenants/:id/admin-token
Authorization: Bearer <token>
X-Correlation-Id: <uuid>
```
Body: vuoto.

### State Machine Effects
Nessuno — operazione read-only (legge `admin_private_key`, firma JWT in memoria).

### External Dependencies
- `createSign("SHA256")` (Node.js runtime) con `dsaEncoding: "ieee-p1363"` (formato raw 64 byte compatibile con Web Crypto ECDSA.verify)
- Supabase `getSupabaseAdmin()` per lettura `admin_private_key`, `vercel_public_url`, `vercel_url`

### Response Contract
```json
// 200 OK
{
  "correlationId": "uuid",
  "token": "<jwt-es256>",
  "adminUrl": "https://<tenant>.vercel.app/admin"
}

// 409 — keypair non configurato
{ "error": "Admin keypair not configured for this tenant.", "code": "ERR_ADMIN_KEYPAIR_MISSING", "correlationId": "uuid" }

// 401 / 403 — auth fallita / accesso negato
// 500 — firma fallita
{ "error": "...", "code": "ERR_ADMIN_TOKEN_ISSUE_FAILED", "correlationId": "uuid" }
```

### Observability
- `correlationId` propagato in tutti i response
- JWT ha `iat` e `exp` verificabili offline con la public key

### Failure Modes & Recovery
| Scenario | Comportamento |
|---|---|
| `admin_private_key` NULL/assente | 409 `ERR_ADMIN_KEYPAIR_MISSING` — generare keypair prima |
| `createSign` fallisce (chiave corrotta) | 500; rigenerare il keypair |
| `vercel_public_url` e `vercel_url` entrambi NULL | `adminUrl` sarà `/admin` — URL incompleto, da verificare |
| JWT scaduto lato middleware tenant (5 min) | 401 sul tenant — l'utente deve cliccare Admin di nuovo |

### Verification Gates
- [ ] JWT restituito ha 3 parti separate da `.`
- [ ] Payload decodificato contiene `sub: "admin-access"`, `iat`, `exp`
- [ ] Firma verificabile con la corrispondente public key EC P-256
- [ ] `adminUrl` punta a un host Vercel valido

## See Also
- ADR-006 (`npm-jpcore/apps/tenant-alpha`) — middleware Edge che verifica i JWT
- ADR-002 (`jsonpages-platform`) — decisione architetturale keypair per-tenant
