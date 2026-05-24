# ADR-006: GitHub App `olonjs` condivisa + token-signing centralizzato

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo deployato deve fare operazioni GitHub a nome del buyer:
- Fork iniziale del repo `save2repo` pubblico nel GitHub del buyer (durante Install funnel)
- Clone dei template `olonjs/*` come nuovi repo tenant (durante Use funnel, vedi [ADR-010](ADR-010-tenant-templates-external-olonjs.md))
- Commit del content via save flow ai repo tenant (vedi [ADR-005](ADR-005-save-flow-repo-only.md))

Criterio di accettazione: **zero extra step** durante l'install (no registrare app, no copia private key).

GitHub offre due meccanismi: **GitHub App** vs **OAuth App**. Inoltre la app può essere **nostra** (condivisa) o **per-buyer**. La combinazione vincolante per "zero extra step" è "GitHub App + nostra condivisa".

## Decision
- **Meccanismo:** GitHub App (non OAuth App)
- **Ownership:** la app `olonjs` esistente (la stessa già usata da jsonpages-platform), pubblica, condivisa tra tutti i deployment save2repo
- **Install UX:** durante Install funnel, redirect a `https://github.com/apps/olonjs/installations/new`. GitHub callback ritorna `installation_id`. Salviamo in `owner_integrations.github_installation_id` del deployment del buyer
- **Run-time:** save2repo deployato chiama nostro endpoint `https://app.olon.it/api/v1/github/installation-token` con bearer token che prova "deployment legit + owner di `installation_id` X". Riceve installation token GitHub scoped a quell'installation, valido 1h
- **Sicurezza:** la private key dell'app `olonjs` non lascia mai il nostro server

## Alternatives Considered

### GitHub App per-buyer (registrata dal buyer nel suo account)
- Pros: zero coupling con nostra infra
- Cons: il buyer registra app + configura webhook + copia private key nelle env vars → multipli extra step manuali
- Rejected: viola criterio "zero extra step"

### OAuth App nostra pubblica
- Pros: setup OAuth standard, più semplice del JWT signing
- Cons: scope `repo` = full read/write su tutti i repo dell'utente (no granular); refresh token a gestione manuale; commits nel nome dell'utente (perde "save2repo[bot]" identity)
- Rejected: pattern parent già è GitHub App; granularità per-repo persa

### OAuth App per-buyer
- Pros: zero coupling
- Cons: stesso problema della GitHub App per-buyer (registrazione manuale)
- Rejected: viola criterio zero extra step

## Consequences
- **Runtime dependency:** save2repo deployato dipende da `app.olon.it/api/v1/github/installation-token` per ogni operazione GitHub
- **Failure mode:** endpoint down → no nuovi save/fork; siti già live restano live (degradation graceful)
- **Da implementare lato nostro:** endpoint token-signing che (i) verifica il bearer del deployment chiamante, (ii) verifica che `installation_id` richiesto appartenga al deployment, (iii) firma JWT con private key olonjs, (iv) chiama GitHub `/app/installations/{installation_id}/access_tokens`, (v) ritorna installation token al deployment
- **Da documentare nel README buyer:** la dipendenza runtime sul nostro service; SLA atteso; status page
- **Coerente con altri coupling olonjs esistenti:** template tenant in `olonjs/*` ([ADR-010](ADR-010-tenant-templates-external-olonjs.md)); Marketplace listing nostro ([ADR-003](ADR-003-vercel-marketplace-native-integration-billing.md))
