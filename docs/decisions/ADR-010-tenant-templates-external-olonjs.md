# ADR-010: Template tenant esterni in org `olonjs/*`

## Status
Accepted

## Date
2026-05-24

## Context
Ogni tenant è un sito web basato su un template (Vite app) clonato come nuovo repo nel GitHub del buyer. Il parent jsonpages-platform usa l'org GitHub `olonjs/*` come catalogo template: repository pubblici flaggati `is_template=true`, listati dinamicamente via `GET /api/v1/templates` + clonati via GitHub API.

Per save2repo (codebase venduto al buyer): dove vivono i template?

## Decision
- I template tenant **restano nell'org GitHub pubblica `olonjs/*`** (la stessa del parent)
- Save2repo deployato fetcha la lista template via GitHub API + clona dall'org `olonjs/*` direttamente nel GitHub del buyer (via installation token, vedi [ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md))
- **Nessun template incluso nel fork save2repo** (no monorepo, no git submodules)

## Alternatives Considered

### Template inclusi nel fork save2repo (monorepo o git submodules)
- Pros: il buyer possiede fisicamente i template, può modificarli localmente; zero dipendenza esterna
- Cons: il fork diventa pesante (N template = N codebase aggiuntivi); nostre release future di template non raggiungono il buyer automaticamente; ogni nuovo template = update del repo save2repo
- Rejected: il buyer beneficia di template aggiornati senza dover updatare il fork; coerente con dipendenza già esistente dall'org `olonjs/*`

## Consequences
- Save2repo ha **runtime dependency** sull'org GitHub `olonjs/*` (esistente, pubblica, stabile)
- Nuovi template rilasciati nell'org `olonjs/*` diventano automaticamente disponibili a tutti i save2repo deployati
- Coerente con altri coupling olonjs accettati: GitHub App `olonjs` ([ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md)), Marketplace listing nostro ([ADR-003](ADR-003-vercel-marketplace-native-integration-billing.md))
- Il buyer non può "modificare un template" prima del clone; può farlo dopo (il template clonato è nel suo GitHub, può modificare al volo)
- Galleria template (UI) implementata come `GET /api/v1/templates` proxy a GitHub API (route preservata dal parent: `templates/route.ts`)
- File `src/lib/olonjsTemplates.ts` preservato dal parent
