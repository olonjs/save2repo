# ADR-011: Supabase Auth config write strategy = Management API + Supabase OAuth nell'install flow

## Status
Accepted

## Date
2026-05-24

## Context

Lo zero-touch save2repo install (vedi obiettivo di [T-202](../plans/save2repo-tasks.md#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch)) richiede che il callback Marketplace configuri programmaticamente 4 settings di Supabase Auth nel project del buyer senza che lui debba aprire Supabase Studio:

1. Abilitare provider GitHub
2. Settare Client ID + Client Secret = credenziali OAuth App `save2repo` ([T-A05](../plans/save2repo-tasks.md#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase))
3. Settare Site URL = deployment URL del save2repo del buyer
4. Aggiungere il deployment URL ai Redirect URLs allowlist

Le 4 scritture vivono nella project Auth config (Studio: Authentication → Providers + URL Configuration), non come env vars del Vercel project.

[T-A04 spike](../spikes/supabase-auth-admin-spike.md) ha investigato due candidate strategy:

- **Option A**: GoTrue admin endpoint del project (`/auth/v1/admin/*`), autenticato con `SUPABASE_SERVICE_ROLE_KEY` (già auto-iniettata da Vercel-Supabase integration per [ADR-007](ADR-007-supabase-via-vercel-integration-guided-redirect.md)).
- **Option B**: Supabase Management API (`api.supabase.com/v1/projects/{ref}/config/auth`), autenticato con access token Supabase (PAT o OAuth).

## Decision

**Option B**: `PATCH /v1/projects/{ref}/config/auth` su Supabase Management API, autenticato con access token ottenuto via **Supabase OAuth flow aggiunto al chain dell'install callback Marketplace**.

Rationale:
1. **Option A è dead** — l'admin API GoTrue copre solo user/identity mgmt (source code confermato in [T-A04 spike](../spikes/supabase-auth-admin-spike.md)); nessun endpoint per provider config / Site URL / Redirect URLs
2. **Option B richiede Supabase access token**; l'unica via per ottenerne uno scoped a un project del buyer è il Supabase OAuth flow (PAT no — scoped al PAT owner; no Vercel shortcut — confermato dai docs)
3. **Alternative a Option B = buyer-manual Auth config in Studio**, che contraddice il goal zero-touch e farebbe re-introdurre la detection logic di T-102.b come wizard

## Consequences

### Amend ADR-007

[ADR-007](ADR-007-supabase-via-vercel-integration-guided-redirect.md) aveva esplicitamente rigettato Supabase OAuth nel install flow ("Cons: richiede OAuth Supabase nel flow (3 OAuth totali: Vercel + GitHub + Supabase = troppo)"). Questa ADR **emenda quella decisione**: Supabase OAuth è ora parte del flow.

Trade-off accettato: 1 extra Supabase OAuth consent (combinabile con la Supabase install redirect, dato che entrambi servono in sequenza) in cambio di **zero buyer-manual config in Studio**. La riga "Da spike-are in Phase 2 implementation: verificare se il Vercel API permette programmatic install di integrations di terzi" in ADR-007 Consequences è **closed**: no.

### Impact su T-202

Il chain dell'install callback è esteso. Step 8 originale ("Configura Supabase Auth provider del buyer") diventa:

1. Dopo l'install redirect Supabase (T-203, già pianificato in ADR-007), redirect a **Supabase OAuth project-claim** (`GET /v1/oauth/authorize/project-claim`) per il project appena creato
2. On consent, cattura `access_token` + `refresh_token`, scoped al project del buyer
3. Usa `access_token` per `PATCH /v1/projects/{ref}/config/auth` con:
   - `external_github_enabled: true`
   - `external_github_client_id` + `external_github_secret` = credenziali centralizzate (T-A05)
   - `site_url: <deployment URL save2repo del buyer>`
   - `uri_allow_list: <pattern includente deployment URL>`
4. Store `refresh_token` cifrato in `save2repo_deployments` per future re-config (es: cambio deployment URL)

Il body schema esatto (snake_case flat dedotto dai docs) va confermato empiricamente nel test pendente di [T-A04 spike §Empirical follow-up](../spikes/supabase-auth-admin-spike.md#empirical-follow-up--blocking-pre-t-202) prima di committare T-202 implementation.

### Impact sull'estensione schema T-A06

`save2repo_deployments` (T-A06 §migration columns) acquisisce 2 nuovi campi:
- `supabase_oauth_access_token_enc text` (cifrato)
- `supabase_oauth_refresh_token_enc text` (cifrato)

più la column `supabase_auth_provider_configured bool default false` già prevista in T-A06.

### Consent click count buyer

Aggiornamento totale (post-ADR-011):

| # | Atto | Inevitabile per |
|---|---|---|
| 1 | Click "Install" Marketplace + Vercel OAuth consent | entry point |
| 2 | GitHub OAuth additional (identity discovery) | risoluzione `installation_id` per GitHub App `olonjs` |
| 3 | GitHub App `olonjs` install consent (se mancante) | GitHub security model |
| 4 | Supabase install (se mancante) + Supabase OAuth project-claim consent | Marketplace + Management API access |
| 5 | Prima "Continue with GitHub" sul deploy save2repo del buyer | sessione `app.olon.it` ≠ `<buyer>.vercel.app` |

Totale: **4-5 consent clicks**, tutti pulsanti Authorize/Install/Continue. **Nessun form da compilare. Nessuna scelta di setting.** Zero-touch UX target rispettato.

### Setup pre-Marketplace lato olonjs backend

Aggiungere registrazione **Supabase Integration** nostra (cfr. [Build a Supabase OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)):
- Crea Supabase OAuth App `save2repo` nel nostro account Supabase olonjs
- Client ID + Secret stored as olonjs-backend secrets (env `SAVE2REPO_SUPABASE_OAUTH_CLIENT_ID` + `*_SECRET`), accanto alle credenziali OAuth App GitHub di T-A05
- Redirect URI = endpoint dedicato del callback Marketplace (es: `/api/integrations/supabase/oauth-callback`)

Questo è un setup one-time, non a costo del buyer.

## Alternatives Considered

### Buyer-manual Auth config in Studio (no Option B)
- Pros: no Supabase OAuth aggiuntiva; ADR-007 sta
- Cons: defeats zero-touch UX; ri-introduce la detection logic di T-102.b (che era stata cancellata proprio per redondance vs T-202)
- Rejected: contraddice il goal che ha generato T-A04

### Supabase PAT di un admin olonjs
- Pros: no per-buyer Supabase OAuth
- Cons: PAT scope = projects del PAT owner / org del PAT owner; non grant access a project del buyer in org del buyer
- Rejected: tecnicamente infeasible

### Pivot a "Supabase for Platforms" (partnership formale Supabase)
- Pros: programmatic provisioning + access tokens via partnership
- Cons: richiede business deal Supabase; out of scope per save2repo v1
- Rejected: scope creep; riconsiderare post-launch

## References

- [T-A04 spike](../spikes/supabase-auth-admin-spike.md)
- [Supabase Management API — Update auth service config](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Supabase — Build an OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [Supabase — Project-claim OAuth flow](https://supabase.com/docs/reference/api/v1-oauth-authorize-project-claim)
- [GoTrue admin.go source](https://github.com/supabase/auth/blob/master/internal/api/admin.go)
- ADR-007 (amended)
