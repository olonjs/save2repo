# Tenant Agent Credentials (`/api/v1/tenants/:id/agents*`)

## Purpose
Gestire credenziali OAuth tenant-scoped per connector MCP remoto (create, list, revoke).

## Trigger / Caller
- Dashboard tenant detail tab `API/Agents`.
- Chiamate client-side autenticate con session token Supabase.

## Request Contract
- `GET /api/v1/tenants/:id/agents`
  - Header: `Authorization: Bearer <session_access_token>`
  - Header opzionale: `X-Correlation-Id`
- `POST /api/v1/tenants/:id/agents`
  - Header: `Authorization: Bearer <session_access_token>`
  - Body: `{ label?: string, scopes?: Array<'read'|'write'> }`
- `DELETE /api/v1/tenants/:id/agents/:credentialId`
  - Header: `Authorization: Bearer <session_access_token>`

## State Machine Effects
- `POST`:
  - genera `client_id` + `client_secret`,
  - persiste solo `secret_hash` + metadati (`client_id`, scope, hint),
  - ritorna `client_secret` in chiaro una sola volta.
- `GET`:
  - legge credenziali tenant ordinate per `created_at desc`.
- `DELETE`:
  - marca `revoked_at` su credenziale attiva.

## External Dependencies
- Supabase Auth via `requireRequestUser`.
- Tenant RBAC via `assertTenantAccess(requiredRole: 'admin')`.
- Supabase table: `tenant_agent_credentials`.

## Response Contract
- Success envelope include `correlationId`.
- `POST` ritorna:
  - `credential` (senza hash),
  - `clientId`,
  - `clientSecret` (show-once),
  - `note` informativa.
- Error format: `{ error, code, correlationId }`.

## Observability
- Correlation ID propagato da header o generato server-side.
- Error code dedicati:
  - `ERR_AGENT_CREDENTIALS_LIST_FAILED`
  - `ERR_AGENT_CREDENTIAL_CREATE_FAILED`
  - `ERR_AGENT_CREDENTIAL_NOT_FOUND`
  - `ERR_AGENT_CREDENTIAL_REVOKE_FAILED`

## Failure Modes & Recovery
- Sessione scaduta/assente -> `401`.
- Ruolo tenant insufficiente -> `403`.
- Credenziale non trovata o gia revocata -> `404` su revoke.
- Errore DB -> `500` con code specifico.

## Verification Gates
- Owner/admin puo creare credenziale e ricevere `client_id/client_secret` show-once.
- `GET` non espone mai `client_secret` in chiaro.
- `DELETE` revoca la credenziale e la rende inutilizzabile.
