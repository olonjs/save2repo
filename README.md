# JsonPages Platform

Orchestratore cloud per [JsonPages](https://jsonpages.io): crea e gestisci tenant sovereign (repo GitHub + deploy Vercel), collega repository esistenti, dashboard progetti.

## Stack

- **Next.js 16** (App Router)
- **Supabase** (auth, tabella `tenants`)
- **GitHub App** (creazione repo da template, lista installazioni/repo)
- **Vercel API** (progetti, env, trigger deploy)

## Avvio

```bash
npm install
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000). Per la dashboard e il flusso di provisioning serve auth Supabase e variabili d'ambiente (vedi `CONTEXT.md`).

## Struttura progetto

| Percorso | Descrizione |
|----------|-------------|
| `src/app/` | Home, auth, dashboard (lista progetti, modal Create Tenant, scheda progetto con tab Overview/Settings/API/Billing) |
| `src/app/api/v1/tenants/` | API tenant: `create` (legacy sync), `provision-stream` (SSE unificato) |
| `src/app/api/v1/github/` | Installazioni e lista repo GitHub |
| `src/app/api/v1/licensing/` | Bridge status GitHub, checkout LS server-side, checkout status |
| `src/app/api/v1/webhooks/ls/` | Webhook LemonSqueezy idempotente per stato licensing |
| `src/lib/` | Supabase client e admin |

## API Docs (flussi funzione)

- Guida completa endpoint-by-endpoint: `docs/api/README.md`
- Include:
  - flussi operativi per tutti gli endpoint `api/v1`,
  - confronto `save` vs `save-stream`,
  - error handling e output contract,
  - diagramma sequence per `save-stream`.

## Flussi principali

- **Provisioning unificato**: Step 1 GitHub → Step 2 scelta sorgente (template o repository) → SSE `provision-stream` (repo create/link → progetto Vercel → env → primo deploy → DB). Redirect a scheda Overview dopo 5 s.
- Se un nome progetto è già usato su Vercel, il sistema prova un suffisso random fino a trovare un nome libero.

## Endpoint consigliati in produzione

- **Provisioning tenant**: usare `/api/v1/tenants/provision-stream`.
- **Salvataggio contenuti**: usare `/api/v1/save-stream` (attende deploy e restituisce `deployUrl` canonico).
- **Licensing Landing-first**: usare `/api/v1/licensing/bridge-status`, `/api/v1/licensing/create-checkout`, `/api/v1/licensing/checkout-status`.
- **Endpoint legacy** (`/api/v1/save`, `/api/v1/tenants/create`): mantenuti per compatibilita, non raccomandati per nuovi flussi.

## Variabili d'ambiente

Vedi **CONTEXT.md** per l’elenco (Supabase, GitHub App, Vercel, Lemon Squeezy) e per dettagli su migrazioni, permessi GitHub e flussi API.

Per il flusso LS Fase 1 servono almeno:

- `LS_API_KEY`
- `LS_STORE_ID`
- `LS_VARIANT_STARTER_ID` (opzionali: `LS_VARIANT_PRO_ID`, `LS_VARIANT_BUSINESS_ID`)
- `LS_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL` (redirect URL assoluto post-checkout)
- `LS_PHASE1_ENABLED=true` (backend rollout flag)
- `NEXT_PUBLIC_LS_PHASE1_ENABLED=true` (frontend rollout flag)
