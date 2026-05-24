# Spec: Blob Static Discovery Files on Hot Save

## Objective

Eliminare il drift tra contenuto salvato via hot save e file di discovery/machine-readable del tenant. Attualmente questi file vengono generati dal build Vite e restano stale finché non parte un cold save + rebuild. Dopo questa feature, ogni hot save aggiorna immediatamente i file su Vercel Blob; il tenant li serve tramite `vercel.json` rewrites, senza rebuild.

**Rif:** ADR-003 (`docs/decisions/ADR-003-blob-static-discovery-files.md`)

---

## File in scope

| File | Path tenant | Blob path |
|---|---|---|
| `robots.txt` | `/robots.txt` | `tenants/{slug}/robots.txt` |
| `sitemap.xml` | `/sitemap.xml` | `tenants/{slug}/sitemap.xml` |
| `llms.txt` | `/llms.txt` | `tenants/{slug}/llms.txt` |
| `mcp-manifest.json` | `/mcp-manifest.json` | `tenants/{slug}/mcp-manifest.json` |
| page JSON | `/{slug}.json` | `tenants/{slug}/pages/{slug}.json` |
| page manifest | `/mcp-manifests/{slug}.json` | `tenants/{slug}/mcp-manifests/{slug}.json` |

**Non in scope:** `schemas/{slug}.schema.json` — dipende da Zod schema instances della DNA del tenant, non dal contenuto. Drift solo su cold save, corretto dal build.

---

## Tech stack

- Platform: Next.js 16 App Router, TypeScript strict, `@vercel/blob`, Supabase admin client
- Builder: `webmcp-contracts.ts` copiato da `@olonjs/core/src/contract/` in `src/lib/webmcpBuilders.ts` — solo `zod` come dipendenza (già presente)
- Tenant repo: `vercel.json` rewrites verso Blob URL stabili

---

## Comandi

```bash
npx tsc --noEmit        # type check
npm run lint            # lint
npm run build           # build produzione (via WSL, non da UNC path Windows)
```

---

## Struttura file nuovi / modificati

```
src/lib/
  webmcpBuilders.ts          # NUOVO — copia di webmcp-contracts.ts + tipi inline
  tenantStaticFiles.ts       # NUOVO — generate + upload helpers

src/app/api/v1/tenants/[id]/
  save2edge-snapshot/route.ts  # MODIFICA — aggiunge step static_files

src/app/api/v1/tenants/
  provision-stream/route.ts    # MODIFICA — commit vercel.json rewrites al provision

scripts/
  backfill-blob-static-files.mjs  # NUOVO — one-shot per tenant esistenti

CONTEXT.md                   # MODIFICA — aggiunge JSONPAGES_BLOB_PUBLIC_BASE alla tabella env vars
```

---

## Contratti di implementazione

### `src/lib/webmcpBuilders.ts`

Copia verbatim di `@olonjs/core/src/contract/webmcp-contracts.ts` con:
- Tipi `PageConfig`, `SiteConfig`, `JsonPagesConfig` inlineati (no import da `@olonjs/core`)
- Commento in testa: `// Copied from @olonjs/core/src/contract/webmcp-contracts.ts — keep in sync manually`
- Esporta: `buildLlmsTxt`, `buildSiteManifest`, `buildPageManifest`, `buildPageContract`, `buildPageContractHref`, `buildPageManifestHref`

---

### `src/lib/tenantStaticFiles.ts`

#### `resolveTenantBaseUrl(tenantId: string): Promise<string>`

Risoluzione URL base per `robots.txt` e `sitemap.xml`:
1. Query `tenant_domains` → `domain` WHERE `tenant_id = tenantId AND status IN ('active', 'verified')` ORDER BY `created_at` ASC LIMIT 1 → `https://{domain}`
2. Fallback: `tenants.vercel_public_url`
3. Fallback: `tenants.vercel_url`
4. Fallback: stringa vuota (file generato con base URL mancante, log warning)

#### `generateTenantStaticFiles(input: GenerateInput): StaticFile[]`

```ts
type GenerateInput = {
  slug: string;
  baseUrl: string;
  pages: Record<string, PageConfig>;
  siteConfig: SiteConfig;
};

type StaticFile = {
  blobPath: string;   // es. "tenants/olon-it/robots.txt"
  content: string;
  contentType: string;
};
```

Genera in memoria tutti i file. `schemas: {}` per `buildLlmsTxt` / `buildSiteManifest` / `buildPageManifest`.

`robots.txt` — stringa template con `baseUrl`:
```
User-agent: *
Allow: /
Disallow: /api/

User-agent: GPTBot
...
Allow: /llms.txt
Allow: /mcp-manifest.json
Disallow: /api/

Sitemap: {baseUrl}/sitemap.xml
```

`sitemap.xml` — XML con `<url>` per ogni slug: human path + `/{slug}.json` + `/schemas/{slug}.schema.json`.

#### `uploadTenantStaticFiles(files: StaticFile[]): Promise<{ uploadedCount: number }>`

- `put(file.blobPath, file.content, { access: 'public', addRandomSuffix: false, contentType: file.contentType, token: resolveBlobToken() })`
- `resolveBlobToken()`: legge `BLOB_READ_WRITE_TOKEN` → `JSONPAGES_READ_WRITE_TOKEN` (stesso pattern di `src/app/api/v1/assets/upload/route.ts`)
- Lancia `ERR_BLOB_TOKEN_MISSING` se token assente

---

### `save2edge-snapshot/route.ts` — step `static_files`

Aggiunto a `StepId`: `"static_files"`.

`TenantRecord` aggiunge `vercel_public_url` e `vercel_url` al SELECT.

Dopo `finalize`:

```
send('step', { id: 'static_files', status: 'running', correlationId })

try {
  baseUrl   = await resolveTenantBaseUrl(tenant.id)
  files     = generateTenantStaticFiles({ slug, baseUrl, pages, siteConfig })
  { uploadedCount } = await uploadTenantStaticFiles(files)
  send('step',  { id: 'static_files', status: 'done', uploadedCount, correlationId })
  send('log',   { message: `Static files: ${uploadedCount} files uploaded to Blob`, correlationId })
} catch (err) {
  send('log',   { level: 'warn', message: `static_files: ${err.message} — hot save not affected`, correlationId })
  // NON emettere 'error' — il hot save è già completato
}
```

`pages` e `siteConfig` sono già disponibili nel contesto dello step `write_store`.

---

### `provision-stream/route.ts` — risoluzione placeholder `vercel.json` durante step `repo`

Durante lo step `repo`, dopo la copia dei file del template nel nuovo repo GitHub e **prima** del trigger del primo deploy Vercel. Un solo deploy viene triggerato, già con i rewrites corretti.

**Il `vercel.json` vive nel DNA del template** (`tenant-radice`). Contiene tutti i rewrites necessari con due placeholder:
- `{BLOB_BASE}` — sostituito con `JSONPAGES_BLOB_PUBLIC_BASE` (es. `https://{store}.public.blob.vercel-storage.com`)
- `{slug}` — sostituito con `vercelSlug` del tenant appena creato

La platform:
1. Legge `vercel.json` dal repo appena creato (già copiato dal template)
2. Esegue `content.replace(/\{BLOB_BASE\}/g, blobBase).replace(/\{slug\}/g, vercelSlug)`
3. Committa il file risolto via GitHub API (stesso pattern già usato per altri file nel flusso)

Se `JSONPAGES_BLOB_PUBLIC_BASE` non configurata: log warning, step skippato, provisioning continua (il tenant non avrà i rewrites Blob finché non viene fatto il backfill).

---

### `scripts/backfill-blob-static-files.mjs`

Script one-shot eseguibile da WSL:

```bash
node scripts/backfill-blob-static-files.mjs [--dry-run]
```

Per ogni tenant con `status = 'active'`:
1. Legge content da `tenant_content_store`
2. Genera + carica su Blob
3. Se il repo manca del `vercel.json` rewrite: fa commit via GitHub API
4. Log per tenant: `OK | SKIP (no content) | ERR (continua)`

Idempotente — rieseguibile senza effetti collaterali.

---

## Variabili d'ambiente

| Variabile | Dove | Uso |
|---|---|---|
| `JSONPAGES_BLOB_PUBLIC_BASE` | Platform (Vercel) | Base URL pubblica del Blob store, es. `https://abc123.public.blob.vercel-storage.com` |
| `BLOB_READ_WRITE_TOKEN` / `JSONPAGES_READ_WRITE_TOKEN` | Platform (Vercel) | Token upload Blob (già usato per assets immagini) |

---

## Boundaries

**Always:**
- `addRandomSuffix: false` su ogni `put()` per i file discovery — path stabile è il contratto
- Step `static_files` non-fatal: mai rollback del hot save per errori Blob
- `schemas: {}` passato ai builder — non cercare di inferire Zod schemas

**Ask first:**
- Aggiungere nuovi file alla lista (cambia il `vercel.json` template e lo schema Blob)
- Cambiare il Blob path scheme (rompe i rewrites dei tenant esistenti)

**Never:**
- Installare `@olonjs/core` sulla platform
- Esporre `BLOB_READ_WRITE_TOKEN` al client
- Emettere SSE `error` event dallo step `static_files` (è non-fatal)

---

## Success Criteria

- [ ] Dopo hot save, `https://{tenant}/robots.txt` restituisce contenuto aggiornato senza rebuild
- [ ] Dopo hot save, `https://{tenant}/llms.txt` riflette le pagine dell'ultimo save
- [ ] Dopo hot save, `https://{tenant}/home.json` restituisce il JSON aggiornato
- [ ] Se Blob non disponibile, il hot save completa comunque con SSE `done`
- [ ] Nuovo tenant provisionato ha `vercel.json` con i 6 rewrites già al primo deploy
- [ ] Script backfill completa su tutti i tenant attivi senza errori bloccanti
- [ ] `npx tsc --noEmit` passa senza errori

## Open Questions

- Il `vercel.json` nei repo tenant esistenti ha già una struttura `rewrites`? Il merge deve preservare rewrites esistenti senza duplicati.
- Il Blob store usato per le immagini ha policy `public` per le read senza token? I rewrites del tenant puntano all'URL pubblico — verificare che non serva autenticazione per le letture.
