# Assets Blob Runbook (MVP -> Enterprise)

## Scope

Runbook operativo per upload immagini tenant su Vercel Blob (`POST /api/v1/assets/upload`) con focus su:

- osservabilita minima in produzione;
- gestione incidenti upload;
- strategia cleanup blob orfani;
- piano migrazione contenuti legacy con `data:image/...`.

## Runtime Signals (MVP)

Endpoint logs:

- `"[assets.upload.completed]"`: upload riuscito
- `"[assets.upload.failed]"`: upload fallito

Campi chiave da indicizzare:

- `correlationId`
- `tenantId`
- `tenantSlug`
- `contentType`
- `sizeBytes`
- `pathname`
- `error` (solo fail)

## Alerting Baseline

Definire alert operativi (SLO iniziale):

1. **Upload failure rate > 3% su 10m**
2. **ERR_BLOB_TOKEN_MISSING > 0** (misconfiguration critica)
3. **ERR_ASSET_RATE_LIMITED spike** (abuso o client loop)

## Incident Playbook

1. Identifica `correlationId` dal client.
2. Cerca log `assets.upload.*` per lo stesso `correlationId`.
3. Se `ERR_INVALID_API_KEY`: ruota / verifica api key tenant.
4. Se `ERR_BLOB_TOKEN_MISSING`: verifica env `BLOB_READ_WRITE_TOKEN` (`JSONPAGES_READ_WRITE_TOKEN` fallback).
5. Se `ERR_FILE_SIGNATURE_INVALID` o `ERR_FILE_TYPE_NOT_ALLOWED`: verificare client payload e tipo file.
6. Se `ERR_ASSET_UPLOAD_FAILED`: verificare status Vercel Blob e retries client.

## Orphan Blob Cleanup Strategy

MVP non elimina automaticamente blob orfani. Strategia raccomandata:

1. Estrarre URL Blob referenziate in `tenant_content_store.content_jsonb`.
2. Elencare Blob sotto prefisso `tenant-assets/`.
3. Calcolare differenza `uploaded - referenced`.
4. Spostare in quarantena o cancellare dopo retention (es. 14 giorni).

Nota: la cancellazione massiva va eseguita con job amministrativo dedicato e dry-run obbligatorio.

## Legacy Migration Plan (`data:image/...`)

### 1) Audit

Query audit (read-only) per misurare scope:

```sql
select tenant_id,
       environment,
       size_bytes,
       updated_at,
       (content_jsonb::text ilike '%data:image/%') as has_data_url
from public.tenant_content_store
order by updated_at desc;
```

### 2) Migrazione progressiva tenant-by-tenant

Per ogni tenant:

1. leggere payload da `tenant_content_store`;
2. trovare campi `data:image/...`;
3. upload su Blob;
4. sostituire con URL Blob;
5. persist via `replaceTenantContent`.

### 3) Verification Gates

- Nessun `data:image/` nel payload post-migrazione.
- Pagina render corretta su tenant target.
- Rollback pronto (snapshot payload precedente).

## Hardening Backlog (fase successiva)

- metriche applicative dedicate (counter/timer) oltre ai log;
- rate-limit distribuito (Redis/Upstash) al posto di in-memory best-effort;
- quota storage per tenant con enforcement server-side;
- job schedulato per orphan cleanup automatizzato.
