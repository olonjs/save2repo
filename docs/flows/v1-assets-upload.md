# v1-assets-upload

## Purpose

Consentire upload immagini dal tenant editor in cloud mode verso Vercel Blob, evitando payload base64 nei JSON di contenuto.

## Trigger / Caller

- Tenant editor (`npm-jpcore`) via `assets.onAssetUpload`.
- Endpoint: `POST /api/v1/assets/upload`.
- Auth model: `Authorization: Bearer <tenant_api_key>`.

## Request Contract

- Method: `POST`
- Headers:
  - `Authorization: Bearer <tenant_api_key>` (required)
  - `X-Correlation-Id` (optional)
- Body: `multipart/form-data`
  - `file` (`File`, required)
  - `filename` (optional string override)

Validation (MVP):
- `content-type` deve essere `multipart/form-data`
- file presente e non vuoto
- max size `ASSETS_MAX_UPLOAD_BYTES` (default 5MB)
- mime type consentiti: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`
- firma binaria coerente con mime dichiarato (magic-bytes check)
- rate limit tenant: `ASSETS_UPLOAD_RATE_LIMIT_PER_MINUTE` (default 30/min, best effort per istanza)

## State Machine Effects

- Nessuna scrittura DB diretta.
- Effetto persistente su storage Blob:
  - object path tenant-scoped `tenant-assets/<tenantId>/<timestamp>-<uuid>-<safeName>.<ext>`
  - `access: public`
- L’URL risultante viene poi persistita indirettamente nel content store tramite `hotSave`.

## External Dependencies

- Supabase (`tenants`) per validare API key e risolvere `tenantId`.
- Vercel Blob (`put`) per upload object.
- Env:
  - `BLOB_READ_WRITE_TOKEN` (primario)
  - `JSONPAGES_READ_WRITE_TOKEN` (alias legacy)
  - `ASSETS_MAX_UPLOAD_BYTES` (optional)

## Response Contract

- `200`:
  - `{ ok: true, correlationId, tenantId, tenantSlug, url, pathname, contentType, size }`
- `400`: `ERR_FILE_MISSING | ERR_FILE_EMPTY | ERR_FILE_TYPE_NOT_ALLOWED`
- `400`: `ERR_FILE_SIGNATURE_INVALID`
- `401`: `ERR_UNAUTHORIZED`
- `403`: `ERR_INVALID_API_KEY`
- `413`: `ERR_FILE_TOO_LARGE`
- `415`: `ERR_UNSUPPORTED_CONTENT_TYPE`
- `429`: `ERR_ASSET_RATE_LIMITED`
- `500`: `ERR_BLOB_TOKEN_MISSING`
- `502`: `ERR_ASSET_UPLOAD_FAILED`

## Observability

- Correlation propagation tramite `x-correlation-id`.
- Log strutturati server-side:
  - `[assets.upload.completed]` con `tenantId`, `contentType`, `sizeBytes`, `pathname`
  - `[assets.upload.failed]` con `tenantId`, `error`
- Error codes stabili per client-side mapping.

## Failure Modes & Recovery

- API key non valida -> client interrompe upload e mostra errore auth.
- Token Blob mancante -> errore server config (500), recovery via env fix.
- File invalido/troppo grande -> errore 4xx con messaggio utente.
- Errore provider Blob -> errore 502 retryable lato client (best effort).

## Verification Gates

1. Upload cloud restituisce URL `*.blob.vercel-storage.com`.
2. URL viene inserita nella pagina tramite ImagePicker.
3. `hotSave` persiste payload senza `data:image/...` per nuovi upload.
4. Upload con API key invalida restituisce `403 ERR_INVALID_API_KEY`.
5. Upload > limite restituisce `413 ERR_FILE_TOO_LARGE`.
