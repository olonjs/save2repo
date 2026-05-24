# AGENTS.md — jsonpages-platform

Questo file è il punto di ingresso per agenti AI (Claude Code, Cursor, Codex, ecc.) che lavorano su questa repo. Per il dettaglio operativo leggere sempre prima `CONTEXT.md`.

## Tech stack

- Next.js 16 (App Router), React 18, TypeScript strict
- Supabase (auth, DB, RLS) con `getSupabaseAdmin()` per operazioni server-side
- GitHub App (Octokit) per provisioning repo tenant
- Vercel API per progetti, env vars, deploy
- LemonSqueezy per billing/licensing

## Comandi

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # ESLint
npx tsc --noEmit     # type check standalone
```

## Convenzioni

- **URL tenant:** tre campi distinti, non confondere. `vercel_url` = deployment URL con hash. `vercel_public_url` = alias Vercel canonico (`<project>.vercel.app`). `tenant_domains` = custom domain. Usare `derivePublicVercelUrl()` da `src/lib/vercelUrls.ts`.
- **MCP gateway:** endpoint raccomandato è tenant-scoped `/api/v1/mcp/t/[tenant]`. L'handler JSON-RPC condiviso è `src/lib/mcpGatewayHandler.ts`. L'auth è OAuth 2.0 (Authorization Code + PKCE) via `/authorize` e `/token`. Credenziali in `tenant_agent_credentials`.
- **Save paths:** `hotSave` (Supabase content store), `coldSave` (repo + deploy Vercel). Mai chiamare `save2edge`/`save2repo` direttamente dalle UI owner: passare dagli endpoint `/api/v1/tenants/:id/save2edge-snapshot` e `/api/v1/tenants/:id/cold-save`.
- **SSE:** tutti i flussi long-running (`provision-stream`, `save-stream`, snapshot, cold-save) emettono eventi `step` / `log` / `done` / `error`. Non bloccare l'handler con attese sincrone.
- **Correlation ID:** ogni endpoint server-side risolve un `correlationId` via `resolveCorrelationId` e lo propaga nei log e nei payload di risposta.
- **Tenant isolation:** qualsiasi endpoint che modifica dati tenant passa da `resolveRequestUser` + `assertTenantAccess` (role check) prima di operare. Il service role Supabase non è accessibile dal client.
- **Idempotency:** mutazioni destructive (domain remove, tenant delete) accettano header `Idempotency-Key`.

## Boundaries

- Non committare mai `.env*`, chiavi Vercel/GitHub/Supabase, LemonSqueezy secrets.
- Non modificare lo schema `tenants` senza creare una migration in `supabase/migrations/` con naming `YYYYMMDDHHMMSS_descrizione.sql`.
- Non aggiungere dipendenze senza verificare impatto bundle e licenza.
- Non invocare `npm run build` dentro terminali Windows su UNC path: usare sempre WSL (`wsl -d Ubuntu --cd /home/dev/jsonpages-platform bash -lc "npm run build"`).
- Non esporre nuovi tool MCP senza aggiornare scope check (`hasScope`) e documentare in `docs/flows/v1-mcp.md` + `AgentsPanel` descriptions.

## Pattern di riferimento

- Route JSON-RPC con OAuth + CORS + correlation: `src/app/api/v1/mcp/t/[tenant]/route.ts`
- Endpoint SSE con step/log events: `src/app/api/v1/tenants/provision-stream/route.ts`
- Client panel con `show-once` secret + copy buttons: `src/app/dashboard/components/agents/AgentsPanel.tsx`
- Helper derivation puro e testabile: `src/lib/vercelUrls.ts`

## Dove trovare cosa

- **Contesto esteso, env vars, flussi dettagliati:** `CONTEXT.md`
- **API docs:** `docs/api/README.md`
- **MCP gateway flow:** `docs/flows/v1-mcp.md`
- **Agents / credenziali:** `docs/flows/v1-tenants-agents.md`
- **Domain module:** `.cursor/rules/domains.mdc`

Se un agente non trova una convenzione qui o in `CONTEXT.md`, **deve chiedere** invece di inventare.
