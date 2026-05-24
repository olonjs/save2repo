# ADR-009: Auth = GitHub OAuth hardcoded (single provider day-1)

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo deployato è single-owner (vedi [ADR-002](ADR-002-single-owner-deployment.md)). Il buyer deve autenticarsi per accedere al CMS. Supabase auth supporta vari provider: GitHub OAuth, Google, email magic link, password, SSO/SAML.

Il buyer ha già OAuth GitHub abilitato come conseguenza dell'install (GitHub App `olonjs` installation, vedi [ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md)). Aggiungere un secondo metodo di auth aggiunge configurazione lato buyer + complessità lato codice (multiple path da testare).

## Decision
Auth nel deployment = **GitHub OAuth singolo, hardcoded nel template**.

Il template save2repo viene con `supabase.auth.signInWithOAuth({ provider: 'github' })` come unico path di login. Zero configurazione lato buyer: clicca "Continue with GitHub", entra.

Auth pluggable a più provider (Google, magic link, SSO/SAML) = **evoluzione post-launch, fuori day-1 scope**.

## OAuth App dedicata vs GitHub App `olonjs` (chiarimento post-setup)

**Importante:** il provider GitHub di Supabase Auth (login utente) NON usa la
GitHub App `olonjs` di [ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md).
Sono due app GitHub distinte con scopi distinti:

| | GitHub App `olonjs` (ADR-006) | OAuth App `save2repo` (questo ADR) |
|---|---|---|
| **Scopo** | Server-to-server: fork repo template, commit save flow ai repo tenant | User login (Supabase Auth provider GitHub) |
| **Registrazione** | Nell'org GitHub `olonjs`/`Olon` — **condivisa** tra tutti i deployment save2repo + jsonpages-platform | Nel GitHub account `olonjs`/`Olon` — **dedicata** save2repo |
| **Callback URL** | (non rilevante per server-to-server; usa installation token signing) | `https://<save2repo-supabase-ref>.supabase.co/auth/v1/callback` |
| **Credenziali** | App ID + private key (gestite dal nostro backend, ADR-006) | Client ID + Client Secret (configurate nel project Supabase del buyer/showcase) |
| **Brand visibile** | "olonjs[bot]" come commit author | "save2repo" come OAuth consent screen |

Perché due e non una:
1. **Callback URL distinto**: una GitHub App ha una sola "User authorization callback URL" registrata (o un set fisso). Quella della GitHub App `olonjs` punta al Supabase di jsonpages-platform; non può anche puntare al Supabase di save2repo senza modificare la registrazione condivisa.
2. **Brand del consent screen**: quando l'utente fa "Continue with GitHub" per save2repo, deve vedere "save2repo" come app che chiede consenso, non "olonjs".
3. **Separazione clean tra prodotti**: jsonpages-platform e save2repo sono prodotti distinti commercialmente (vedi [ADR-001](ADR-001-fork-from-jsonpages-platform.md)); che ognuno abbia la sua OAuth App è coerente con il fork separato.

L'OAuth App `save2repo` viene creata una volta sola dal team Olon (showcase setup) e le sue credenziali (Client ID + Secret) sono inserite manualmente nel Supabase Auth Providers GitHub di ciascun deployment buyer durante l'onboarding. In Phase 2 (T-202) il Marketplace install callback potrà automatizzare anche questa configurazione via Supabase Auth Admin API.

## Alternatives Considered

### Auth pluggable con provider configurabili dal buyer post-install
- Pros: flessibilità totale; agenzie con SSO aziendale supportate
- Cons: più setup per il buyer (abilitare provider in Supabase Studio); più complessità di test/build (N provider da supportare); contraddice "zero config day-1"
- Rejected: scope creep al day-1; può arrivare come ADR successivo se emerge demand

### Auth pluggable ibrida (default GitHub + slot config opzionale)
- Pros: best of both
- Cons: due codepath da mantenere; due test path; documentazione doppia
- Rejected: complessità non giustificata al day-1

## Consequences
- `signInWithOAuth({ provider: 'github' })` hardcoded nel login UI di save2repo
- Buyer deve abilitare GitHub OAuth provider nel suo Supabase project (configurazione one-time, documentata nel README per buyer)
- Identità del buyer-owner = il suo GitHub user (email + avatar disponibili via OAuth)
- Aggiungere un secondo provider in futuro = breaking change minore (richiede Supabase config + UI update); ADR successivo
- Non c'è "signup flow" — al first login, l'utente è automaticamente l'unico owner (single-owner, [ADR-002](ADR-002-single-owner-deployment.md))
