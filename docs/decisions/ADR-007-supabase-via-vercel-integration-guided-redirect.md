# ADR-007: Supabase via Vercel Marketplace integration + guided redirect

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo deployato nel Vercel del buyer ha bisogno di un Supabase project per: `users` (1 owner), `tenants`, `owner_integrations`, `tenant_agent_credentials`, `tenant_domains`, `admin_private_key` (pgsodium-encrypted). Lo spec richiede: *"Supabase punta al buyer's Supabase project via env vars; nessuna istanza Supabase gestita da noi è runtime dependency"*.

**Assumption originale (smentita dalla verifica):** il Marketplace Vercel supporta "required co-install" formale tra integrations.

**Verifica della docs Vercel:** il Metadata schema delle Native Integration supporta solo controls input (string, toggle, region, domain, git-namespace) — nessun `require-integration`. L'unico pattern "auto-install dipendente" documentato è nei Vercel Starter Templates / Deploy Button, non in Marketplace Native Integration.

**Verificato (✅):** la Supabase integration nativa Vercel auto-inietta 13 env vars nel project, incluso `SUPABASE_SERVICE_ROLE_KEY` (necessaria per migrations auto-bootstrap).

## Decision
- Save2repo Marketplace listing dichiara Supabase come "required dependency" nella description testuale (no enforcement formale possibile)
- Nel **callback handler `/api/integrations/vercel/install`** lato nostro, dopo aver creato il project Vercel del buyer, controllo via Vercel API se Supabase integration è installata nel team:
  - **Se sì:** aggancio env Supabase al project save2repo via Vercel API, procedo con deploy
  - **Se no:** redirect del buyer (dentro lo stesso flow, prima del welcome screen) a `https://vercel.com/integrations/supabase/new?teamId=...&projectId=<save2repo-project>` con `state` per ritornare al nostro flow. Buyer fa **1 click extra** di install Supabase. Vercel inietta env. Ritorno a noi → deploy
- Save2repo deployato al **first boot:** detecta env `SUPABASE_*` + esegue **auto-migrate** baseline (idempotente: controlla se tabelle esistono prima di crearle)

## Alternatives Considered

### Supabase Management API auto-provision durante install
- Pros: zero click extra del buyer (noi creiamo il Supabase project programmaticamente)
- Cons: richiede OAuth Supabase nel flow (3 OAuth totali: Vercel + GitHub + Supabase = troppo); Supabase Management API per account-level project creation potrebbe avere limiti non documentati
- Rejected: aumenta friction sopra il guadagno marginale

### Wizard manuale post-install (buyer crea Supabase, copia URL/keys nelle env Vercel)
- Pros: zero coupling Marketplace
- Cons: viola "zero extra step" criterio; multiple copy-paste
- Rejected: anti-self-serve

### Supabase shared olonjs (noi gestiamo un DB centralizzato per tutti i buyer)
- Pros: zero setup per il buyer
- Cons: viola spec esplicito ("nessuna istanza Supabase gestita da noi"); single point of failure; non scalabile
- Rejected: viola architettura BYO

## Consequences
- **UX worst-case = 1 click extra** (install Supabase via redirect Vercel)
- **Auto-migrate baseline al first boot:** save2repo applica schema (users, tenants, owner_integrations, tenant_agent_credentials, tenant_domains, admin_private_key) tramite `SUPABASE_SERVICE_ROLE_KEY`
- **Error UX:** se al first boot le env Supabase mancano, UI esplicita "Add Supabase integration to your Vercel team to continue" con link
- **Da spike-are in Phase 2 implementation:** verificare se il Vercel API permette **programmatic install** di integrations di terzi nel team del buyer (eliminerebbe il click extra)
- **Da confermare prima del Marketplace submission:** modello billing Supabase (Vercel native billing forward al vendor Supabase vs Supabase fattura direttamente al buyer)

## References
- [Supabase for Vercel – Marketplace](https://vercel.com/marketplace/supabase)
- [Vercel Integration and Next.js App Router Support – Supabase Blog](https://supabase.com/blog/using-supabase-with-vercel)
- [Create a Native Integration – Vercel docs](https://vercel.com/docs/integrations/create-integration/marketplace-product)
