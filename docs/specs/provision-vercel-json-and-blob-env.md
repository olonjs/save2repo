# Spec: provision — vercel.json generation + BLOB_TENANT_DISCOVERY_BASE injection

## Objective

Durante il provision di un tenant (sia da template che da repository esistente), la platform deve:
1. Generare il `vercel.json` completo con tutti i Blob rewrites e commitarlo nel repo GitHub del tenant
2. Iniettare `BLOB_TENANT_DISCOVERY_BASE` come env var sul progetto Vercel del tenant

Entrambe le operazioni sono non-fatali e devono funzionare per entrambi i source type.

## Commands

```bash
wsl --distribution Ubuntu bash -ic "cd /home/dev/jsonpages-platform && npx tsc --noEmit"
```

## File toccato

```
src/app/api/v1/tenants/provision-stream/route.ts   # unica modifica — solo aggiunta di nuovo codice
```

## Contratto di implementazione

### Task 1 — Generazione e commit `vercel.json`

**Posizione:** dopo `send('step', { id: 'env', status: 'done' })`, prima di `send('step', { id: 'deploy', ... })`.

**Guard:** `blobPublicBase && state.githubRepoOwner && state.githubRepoName` — nessun check su `source.type`.

**Logica:**
```ts
// 1. Genera contenuto vercel.json con URL reali
const vercelJsonContent = JSON.stringify({
  rewrites: [
    { source: '/robots.txt',                destination: `${blobPublicBase}/tenants/${vercelSlug}/robots.txt` },
    { source: '/sitemap.xml',               destination: `${blobPublicBase}/tenants/${vercelSlug}/sitemap.xml` },
    { source: '/llms.txt',                  destination: `${blobPublicBase}/tenants/${vercelSlug}/llms.txt` },
    { source: '/mcp-manifest.json',         destination: `${blobPublicBase}/tenants/${vercelSlug}/mcp-manifest.json` },
    { source: '/mcp-manifests/:path*.json', destination: `${blobPublicBase}/tenants/${vercelSlug}/mcp-manifests/:path*.json` },
    { source: '/:path*.json',               destination: `${blobPublicBase}/tenants/${vercelSlug}/pages/:path*.json` },
    { source: '/(.*)',                      destination: '/index.html' },
  ],
  headers: [
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ],
}, null, 2);

// 2. Leggi SHA se il file esiste già (per poterlo sovrascrivere)
let existingSha: string | undefined;
try {
  const existing = await octokit.rest.repos.getContent({ owner, repo, path: 'vercel.json' });
  const data = existing.data;
  if (!Array.isArray(data) && 'sha' in data) existingSha = data.sha;
} catch { /* file non esiste — ok */ }

// 3. Commit
await octokit.rest.repos.createOrUpdateFileContents({
  owner: state.githubRepoOwner,
  repo: state.githubRepoName,
  path: 'vercel.json',
  message: 'chore: configure Blob discovery rewrites',
  content: Buffer.from(vercelJsonContent).toString('base64'),
  ...(existingSha ? { sha: existingSha } : {}),
});
```

**Error handling:** `try/catch` — `send('log', { stepId: 'env', message: 'WARN: vercel.json commit fallito ...' })`, provision continua.

---

### Task 2 — Iniezione `BLOB_TENANT_DISCOVERY_BASE`

**Verifica:** controllare che nell'array `envs` esistente (già nel codice) la voce `BLOB_TENANT_DISCOVERY_BASE` sia presente e corretta per entrambi i source type. Se è già presente e corretto, nessuna modifica necessaria.

**Valore atteso:** `${blobPublicBase}/tenants/${vercelSlug}`

---

## Boundaries

- **Always:** non toccare codice esistente non scritto da me in questa sessione
- **Always:** non-fatal — mai bloccare il provision per errori in questi step
- **Never:** modificare la struttura degli step SSE esistenti (`repo`, `vercel`, `env`, `deploy`, `db`)
- **Never:** aggiungere guard su `source.type`

## Success Criteria

- [ ] `npx tsc --noEmit` pulito
- [ ] Provision da **repository**: `vercel.json` nel repo ha tutti i rewrites con URL Blob reali, nessun placeholder
- [ ] Provision da **template**: idem
- [ ] Provision da **repository**: progetto Vercel del tenant ha `BLOB_TENANT_DISCOVERY_BASE` impostata
- [ ] `JSONPAGES_BLOB_PUBLIC_BASE` assente sulla platform: provision completa senza errori, log warning emesso
