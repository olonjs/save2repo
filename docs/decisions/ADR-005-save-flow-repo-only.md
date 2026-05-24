# ADR-005: Save flow = save2repo only

## Status
Accepted

## Date
2026-05-24

## Context
Il parent jsonpages-platform ha uno stack di save flow complesso:
- `hotSave` / `save2edge` → Edge Config per latency bassa
- `tenant_content_store` (Supabase) come hot store + dirty-state tracking
- `save2repo` / `cold-save` per push periodico al repo GitHub + deploy Vercel
- `save2edge-snapshot` per copiare dal repo al store

Per save2repo come prodotto deployato dal buyer nel suo Vercel:
- **"Zero costi di CMS"** (positioning chiave): il content non deve vivere su infrastruttura nostra né su infrastruttura paid del buyer (Edge Config)
- Single source of truth: l'ambiguità "edge vs store vs repo" è una categoria di bug che vogliamo eliminare
- Latency 30–90s (commit + Vercel rebuild) accettata come trade-off comunicato nei Success Criteria della spec

## Decision
Save flow = solo `save2repo`. Ogni modifica del content nel CMS = commit GitHub al repo del tenant (debounced/batched), seguito da rebuild automatico Vercel via push webhook.

**Rimossi dal fork:**
- `src/app/api/v1/hotSave/`
- `src/app/api/v1/tenants/[id]/save2edge-snapshot/`
- `src/app/api/v1/content/` (read da Edge Config)
- `src/lib/saveEdgeConfig.ts`
- `src/lib/saveContentCache.ts`
- `src/lib/saveRepoToEdgeMap.ts`
- `src/lib/saveStoreToRepoMap.ts`
- `src/lib/tenantContentStore.ts`

**Preservati:** `saveRepoCommitDeploy.ts` come core del save flow + sue dipendenze pulite (`saveJspMap.ts`, `saveTelemetry.ts`, route `save2repo/route.ts`, route `cold-save/route.ts`).

## Alternatives Considered

### Mantenere hot+cold save come nel parent
- Pros: latency bassa per l'editor (hot save instant); fallback cold se hot down
- Cons: introduce dipendenza Edge Config nel codebase save2repo (= ulteriore servizio paid del buyer); contraddice "zero costi di CMS" positioning; mantiene la complessità del dual-source-of-truth
- Rejected: il prodotto pitch è "trade un po' di latency per zero CMS cost"; aggiungere hot save invalida il pitch

### Hot save via Supabase del buyer (no Edge Config), cold save al repo
- Pros: latency bassa via Supabase realtime; resta single source effettivo perché Supabase è transient cache
- Cons: il content del buyer vivrebbe parzialmente in Supabase tra save → contraddice "content nel repo, full stop"; complica il modello mentale del buyer
- Rejected: il save model deve essere semplice da spiegare — "save = commit"

## Consequences
- Editor del CMS implementa **debounce client-side** (5–30s di idle prima del commit) per non spammare la git history
- Vercel rebuild automatico via push webhook (pattern standard); il save SSE mostra step `commit → vercel rebuild → ready`
- Latency comunicata esplicitamente in UI (es. "Saving… your site will be live in ~30s")
- MCP tool `save` (esposto agli agenti) usa lo stesso path = save2repo only
- Nessuno storage di content lato nostro né lato Edge Config del buyer → coerente con [ADR-007](ADR-007-supabase-via-vercel-integration-guided-redirect.md) (Supabase del buyer contiene solo metadata, non content tenant)
