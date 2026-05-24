# Implementation Plan: save2repo

## Overview

Forkare jsonpages-platform in `save2repo` (history clean-start), ripulirlo dai pezzi out-of-scope (vedi [ADR-005](../decisions/ADR-005-save-flow-repo-only.md), [ADR-008](../decisions/ADR-008-custom-domains-vercel-api-only.md)), riadattarlo al modello single-owner / client-Vercel-only ([ADR-002](../decisions/ADR-002-single-owner-deployment.md), [ADR-003](../decisions/ADR-003-vercel-marketplace-native-integration-billing.md)), e produrre un deployment che (a) funzioni se installato a mano, (b) sia installabile via Vercel Marketplace, (c) sia approvato e listato sul Marketplace pubblico. Parallelamente costruire i componenti **cross-project** in jsonpages-platform (api.olon.it) richiesti dall'architettura: endpoint token-signing per la GitHub App olonjs ([ADR-006](../decisions/ADR-006-shared-olonjs-github-app-with-token-signing.md)), callback Marketplace install, registrazione/auth dei deployment buyer.

## Architecture decisions (riferimento ADR)

Tutte chiuse — vedi [`docs/decisions/`](../decisions/README.md) per dettagli.

- ADR-001 fork + clean history · ADR-002 single-owner · ADR-003 Native Integration + subscription · ADR-004 BUSL 1.1 pubblico · ADR-005 save2repo only · ADR-006 GitHub App olonjs condivisa · ADR-007 Supabase Marketplace + redirect guidato · ADR-008 custom domains via Vercel API · ADR-009 GitHub OAuth hardcoded · ADR-010 template `olonjs/*` esterni

## Dependency graph (macro)

```
Phase 0  (save2repo)         Phase A  (jsonpages-platform / api.olon.it)
repo setup & pulizia         GitHub token-signing endpoint
   │                              │
   └─→ Phase 1  (save2repo)       │
       use funnel  ◄───────────── BLOCK (save flow + fork operations
   (deployato a mano funziona      necessitano token-signing live)
    end-to-end)                                     │
        │                                           │
        │            Phase A2  (jsonpages-platform) │
        │            Marketplace callback handler   │
        │            + deployment registration      │
        │                       │                   │
        └──────────────►  Phase 2  (mix) ◄──────────┘
                         install funnel (auto, da Marketplace)
                              │
                              └─→ Phase 3  Marketplace submission & approval
```

**Parallelizzazione:** Phase A può partire **in parallelo** a Phase 0 (lavoro su jsonpages-platform, dev session separata). Phase 1 può iniziare prima che Phase A finisca, ma alcuni step (fork operations T-106, save flow T-108) sono verificabili end-to-end solo dopo Phase A verde.

## Phases

### Phase 0 — save2repo repo setup & pulizia
Dir save2repo ha codice forkato dal parent, pulito, builds/lints/tsc verdi, primo deploy Vercel mock funzionante.

### Phase A — Cross-project deps in jsonpages-platform (parallelo a 0/1)
Infrastruttura olonjs backend pronta a servire i deployment save2repo: token-signing endpoint, registry deployment, callback skeleton.

### Phase 1 — Use funnel (save2repo)
save2repo deployato (manualmente in Phase 0) permette al single-owner di completare l'intero use funnel: auth → re-auth integrations → crea tenant → editor o MCP → save → tenant live → custom domain.

### Phase 2 — Install funnel (mix)
Utente dal Vercel Marketplace pubblico → installa save2repo → ottiene deployment funzionante senza setup manuale.

### Phase 3 — Marketplace submission & approval
Listing pubblico vivo + 3 inviti esterni testano l'install end-to-end.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Vercel approval lenta (settimane) | Alto su timeline | Iniziare submission materials in Phase 2, non aspettare Phase 3 |
| GitHub installation-token endpoint instabile = downtime per tutti i deployment | Critico (single point of failure) | SLA chiaro nel readme buyer; status page; retry + jitter; multi-region deploy nostro backend |
| Programmatic install Supabase/GitHub via API non fattibile | Medio (UX = +1 click extra) | Spike anticipato in Phase 2 (T-203/T-204); fallback redirect guidato già pianificato |
| Native billing setup mai fatto | Medio | Spike isolato + esempio Vercel come scaffold |
| MCP non funziona day-1 | Critico (è il moat) | Smoke test E2E (Claude esterno → MCP → save) come checkpoint blocking di Phase 1 (T-110) |
| Save latency 30-90s percepita come bug | Medio | Progress UI esplicito + comunicazione "saving" |
| Auto-migrate baseline introduce regression in Supabase del buyer | Medio | Idempotency + dry-run + smoke test su Supabase fresh |

## Parallelization rules

- **Sequenziale:** Phase 0 → Phase 1; Phase A → blocking di T-106/T-108/T-110; Phase 2 → Phase 3
- **Parallelo:** Phase A può iniziare con Phase 0 (sessione separata); listing materials T-301 possono iniziare durante Phase 2
- **Coordinazione contratto:** Phase A endpoint shape ↔ Phase 1 T-104 client — definire shape request/response prima di parallelizzare

## Tasks granulari

Vedi [save2repo-tasks.md](save2repo-tasks.md) per la decomposizione completa in 31 task.
