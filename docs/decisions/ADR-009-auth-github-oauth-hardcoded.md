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
