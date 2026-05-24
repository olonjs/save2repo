# v1-assets-list

## Purpose

Restituire la libreria immagini Blob del tenant autenticato per popolare la tab `Libreria` dell'Image Picker in cloud mode.

## Trigger / Caller

- Tenant editor (`npm-jpcore`) quando inizializza/rinfresca `assetsManifest`.
- Endpoint: `GET /api/v1/assets/list`.
- Auth model: `Authorization: Bearer <tenant_api_key>`.

## Request Contract

- Method: `GET`
- Headers:
  - `Authorization: Bearer <tenant_api_key>` (required)
  - `X-Correlation-Id` (optional)
- Query params (optional):
  - `limit` (`1..200`, default `60`)
  - `cursor` (opaque pagination token)

Validation:
- API key presente e valida su `tenants`.
- token Blob disponibile (`BLOB_READ_WRITE_TOKEN` o alias legacy).
- prefix Blob derivato esclusivamente da tenant risolto server-side.

## State Machine Effects

- Nessuna scrittura DB.
- Nessuna mutazione Blob.
- Solo lettura lista oggetti Blob tenant-scoped.

## External Dependencies

- Supabase (`tenants`) per validare API key e risolvere `tenantId`.
- Vercel Blob (`list`) per leggere oggetti sotto prefix `tenant-assets/<tenantId>/`.
- Env:
  - `BLOB_READ_WRITE_TOKEN` (primario)
  - `JSONPAGES_READ_WRITE_TOKEN` (alias legacy)

## Response Contract

- `200`:
  - `{ ok: true, correlationId, tenantId, tenantSlug, items, cursor, hasMore }`
  - `items[*]` include contract compatibile `LibraryImageEntry`:
    - `id`, `url`, `alt`, `tags`
    - metadata accessorie: `pathname`, `contentType`, `uploadedAt`
- `401`: `ERR_UNAUTHORIZED`
- `403`: `ERR_INVALID_API_KEY`
- `500`: `ERR_BLOB_TOKEN_MISSING`
- `502`: `ERR_ASSET_LIST_FAILED`

## Observability

- Correlation propagation tramite `x-correlation-id`.
- Log errore strutturati:
  - `[assets.list.failed]` con `tenantId`, `tenantSlug`, `error`.
- Error codes stabili per mapping lato client.

## Failure Modes & Recovery

- API key non valida -> client mostra errore auth e fallback libreria vuota.
- Token Blob mancante -> errore server config (`500`), recovery via env fix.
- Errore provider Blob -> errore `502`, client può ritentare su prossima apertura picker.

## Verification Gates

1. Tenant A vede in `Libreria` solo immagini sotto `tenant-assets/<tenantAId>/`.
2. Tenant B non vede immagini tenant A con la propria API key.
3. Dopo upload riuscito, il refresh manifest mostra l'immagine in `Libreria`.
4. `cursor`/`hasMore` coerenti con paginazione Blob quando la libreria supera il limite.
