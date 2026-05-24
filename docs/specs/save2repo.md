# Spec: save2repo

> **Decisioni architettoniche:** vedi [docs/decisions/](../decisions/) per gli ADR completi
> (contesto, alternative considerate, conseguenze).

## Origin & implementation approach

save2repo nasce come **fork del repo `jsonpages-platform`** (oggi deployato come
`app.olon.it`). jsonpages-platform resta intatto e indipendente; save2repo evolve
a parte come prodotto distinto, sotto un'identità di brand e una traiettoria
commerciale proprie.

**Repo target:** pubblico, license-gated. Il source è leggibile da chiunque (così
Vercel Integration può accedere al template al momento dell'install + il buyer può
ispezionare prima di acquistare), ma l'**uso commerciale è subordinato a una
licenza acquistata**. Licenza: **BUSL 1.1** (Business Source License). Wording
specifico (Additional Use Grant, change date) finalizzato prima del Marketplace
submission.

### Pezzi da rimuovere o stravolgere nel fork

- **Supabase nostro centralizzato:** Supabase resta tech-of-choice nel codice, ma
  punta al *buyer's Supabase project* via env vars. Nessuna istanza Supabase
  gestita da noi è dependency di runtime.
- **Billing LemonSqueezy:** rimosso dal repo. Il billing del prodotto save2repo
  vive sul **Vercel Marketplace (native billing)**, non nel codice deployato.
  Nessuna integrazione billing nel codebase save2repo.
- **`tenant_content_store`:** rimosso. Il content dei tenant vive *solo* nel
  repo GitHub di ciascun tenant, salvato via commit.
- **Edge Config / hot-save (`save2edge`):** rimosso. Esiste solo `save2repo`.
- **Cloudflare-specific orchestration:** rimosso. `cloudflareApi.ts`,
  routes DNS records `tenants/[id]/domains/[domain]/cf-*` e `dns/**`,
  DLQ `internal/domains/**`, migrations `tenant_domains_cloudflare` e
  `tenant_domains_cf_zone_apex` non vengono nel fork. Save2repo gestisce i
  custom domains via Vercel domains API; il DNS sta nel registrar del buyer.
  Cloudflare-specific automation = feature post-launch eventuale.
- **Provisioning flow "Full"** (provision sul nostro Vercel team): rimosso.
  L'unico flusso di provisioning è "client_vercel" (provision sul Vercel del
  buyer).

### Pezzi da preservare come moat o fondamenta

- **MCP gateway + admin keypair signing** (moat principale: agenti AI parlano al
  CMS via MCP standard)
- **A2A + webMCP** (estensioni del moat agentico)
- **GitHub App / Octokit client** (per fork del template + commit `save2repo` ai
  tenant)
- **Vercel API client** (per provision tenant + log passthrough nella dashboard)
- **Auth Supabase** con **GitHub OAuth hardcoded** come unico provider al day 1
  (zero config lato buyer; auth pluggable a più provider = evoluzione
  post-launch, fuori day-1 scope); punta al buyer's Supabase project
- **Provision-stream SSE pattern** (riusato per provisionare ogni tenant nel
  Vercel del buyer, con dispatcher su `deployment_target = client_vercel`)
- **Template tenant ecosystem `olonjs/*`** (la galleria dinamica di template
  Vite che ogni tenant clona come base) — i template vivono nell'org GitHub
  pubblica `olonjs/*`, save2repo deployato li fetcha via GitHub API. Niente
  template inclusi nel fork save2repo.
- **Custom domains (via Vercel domains API)** — il buyer mappa domini propri
  (es. `www.cliente.it`) ai suoi tenant; senza questo i siti restano
  `*.vercel.app` e il prodotto non è utilizzabile in produzione. Stack
  preservato dal parent: routes `tenants/[id]/domains/**` (escluse le
  sotto-route Cloudflare), `customDomains.ts`, `vercelDomains.ts`,
  `domainParsing.ts`, `domainTelemetry.ts`, migrazione `tenant_domains_enterprise`
  (escluse le `cloudflare` e `cf_zone_apex`). Il buyer fa il DNS setup sul suo
  registrar/provider (qualunque: Cloudflare, Route53, Google Domains, Namecheap,
  ecc.); save2repo guida con verify standard via Vercel.

## Objective

**What:** save2repo è un CMS multi-tenant distribuito come Vercel Integration. Il
buyer (dev singolo, dev shop, agenzia, founder) lo installa nel proprio team
Vercel via Marketplace, ottiene il source code nel proprio account GitHub, e lo
deploya come progetto Vercel proprio. Da quel deployment — lui unico utente —
gestisce N siti tenant, ognuno con proprio progetto Vercel + repo GitHub
(anche questi nel suo account). I contenuti dei tenant non vivono su
infrastruttura nostra: vengono salvati direttamente nel repo GitHub del tenant
via commit. `save2repo` = "save al repo, zero storage centralizzato di content".

**Why now:** la categoria CMS è satura ma omogenea — quasi tutti (Sanity,
Contentful, Strapi, Payload, Decap) tengono il content sul loro storage, paghi
proporzionalmente alla crescita, e l'editing rimane "umano apre editor". Due
cambi recenti ribaltano il gioco:

- AI agents come primo editor del content (MCP / A2A / webMCP come standard di
  interfaccia macchina-leggibile)
- Vercel come hosting universale per stack moderni (l'audience target ha già
  Vercel + GitHub, non vuole un'altra fattura)

save2repo prende entrambi e ne fa prodotto: CMS con MCP server per tenant,
content nel repo del cliente (0 cost storage), distribuzione via Vercel
Marketplace (0 friction install).

**Who:** singolo proprietario del deployment — dev tech-savvy che gestisce
~5–50 siti tenant per sé o clienti, ha già Vercel + GitHub, vuole CMS senza
recurring cost di content storage, considera "AI agents come editor" un trend
probabile non gimmick. Non multi-utente: solo lui entra nel proprio save2repo.
I clienti finali (eventuali) ricevono i siti pronti, non accedono al CMS.

**Distribution & commercial:** distribuzione via **Vercel Native Integration**
sul Marketplace. Pricing: **subscription via Vercel native billing** — il
cliente sceglie un piano durante l'install dal Marketplace, Vercel addebita
attraverso il suo Vercel account, noi riceviamo payout via revenue share
Vercel. Tiering specifico (free trial, plan tiers per N tenant gestiti, addon
usage-based) finalizzato prima del Marketplace submission. Acquisto =
subscription al diritto di installare save2repo nel proprio team Vercel + uso
del source code per gestire i propri tenant + supporto. No SaaS gestito da noi
(il deployment vive nel Vercel del cliente).

**Two distinct UX funnels** (entrambi da progettare esplicitamente):

1. **Install funnel (one-time):** Marketplace → **selezione piano (Vercel
   native billing)** → "Install" → OAuth Vercel + GitHub → noi
   programmaticamente forkiamo save2repo nel suo GitHub + creiamo project
   Vercel + setup env + deploy → buyer riceve URL del proprio save2repo.
2. **Use funnel (recurring):** buyer entra in save2repo → re-auth integrations
   al first login (Vercel + GitHub tokens vivono nel suo DB, non transfer
   da install) → dashboard → crea tenant → editor o agenti AI che parlano via
   MCP → save2repo commit sul repo del tenant → Vercel rebuild auto → tenant
   live.

## Success Criteria (bozza)

- **Install funnel self-serve:** buyer completa Install → first dashboard load
  in <10 min senza alcun ticket di support.
- **Use funnel self-serve:** primo tenant creato + primo save reale (via agente
  o manualmente) in <15 min dalla dashboard, senza ticket.
- **MCP/A2A day-1:** un agente esterno (Claude, ChatGPT custom GPT, custom A2A
  peer) si autentica al MCP server di un tenant e modifica una sezione di
  contenuto end-to-end, senza che il buyer abbia scritto una riga di codice MCP.
- **Latency trade-off accettato:** save → live deploy time 30–90s (commit +
  Vercel rebuild) accettato dai buyer pre-launch interviewed in cambio di
  "0 content storage cost".
- **Vercel Marketplace listing approved:** save2repo è pubblicato e installabile
  dal Marketplace pubblico Vercel al go-live.
