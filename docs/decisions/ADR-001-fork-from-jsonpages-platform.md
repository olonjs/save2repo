# ADR-001: Fork separato da jsonpages-platform

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo è un nuovo prodotto CMS multi-tenant distinto da jsonpages-platform. Il primo GTM è la vendita del repo come licenza commerciale (vedi [ADR-004](ADR-004-license-busl-and-public-source.md)). Per essere venduto e installato dal buyer, il codebase deve essere indipendente, pulito e "presentabile" — senza i pezzi specifici del SaaS jsonpages-platform (LemonSqueezy billing, Cloudflare-specific domain orchestration, hot-save / Edge Config, tenant content store centralizzato, provisioning flow "Full").

## Decision
Fork separato di jsonpages-platform: nuovo repo `save2repo` con codebase indipendente, history clean-start (no parent git history). jsonpages-platform resta intatto come prodotto distinto (deployato come `app.olon.it`).

## Alternatives Considered

### Monorepo (Turborepo / Nx) con `apps/full` + `apps/starter` + `packages/*` condivisi
- Pros: zero drift sui primitives (Vercel client, GitHub helper, UI), upgrade dal "starter" al "full" come migration di target invece di switch tra prodotti
- Cons: per vendere il source code del solo save2repo dovremmo estrarlo come bundle standalone (fattibile ma overhead build pipeline + tagging); il buyer non vede mai `apps/full` ma noi dobbiamo disciplinare la separazione interna
- Rejected: la vendita del repo come primo GTM rende il monorepo un'ottimizzazione futura non essenziale; il costo della separazione fisica vale la pulizia di unitarietà commerciale

### Single codebase + flag globale `PLAN_FULL_ENABLED`
- Pros: massimo riuso, nessuna duplicazione
- Cons: due architetture profondamente diverse (single-owner vs multi-tenant SaaS, save-only vs hot+cold, no domain orchestration vs full) collassano sotto il peso della flag in ogni feature; il "prodotto vendibile" non esiste come unità separata
- Rejected: la divergenza architetturale è troppo strutturale per essere gestita da una flag

## Consequences
- jsonpages-platform e save2repo evolvono indipendenti; bug fix e primitives vanno mantenuti in entrambi se necessario (accettato)
- Possibile upgrade futuro da save2repo a una versione "managed" richiederebbe migrazione tra prodotti, non un toggle (accettato)
- I template tenant `olonjs/*` restano condivisi tra i due (vedi [ADR-010](ADR-010-tenant-templates-external-olonjs.md))
- L'app GitHub `olonjs` resta condivisa (vedi [ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md))
- Setup tecnico del fork: `git clone --depth 1` + sever history per partire senza il bagaglio del parent
