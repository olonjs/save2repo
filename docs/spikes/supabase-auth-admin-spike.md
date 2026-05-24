# Spike: Supabase Auth config write strategy (T-A04)

## Goal

Verificare se le 4 scritture di configurazione Supabase Auth richieste per il zero-touch save2repo install possono essere fatte programmaticamente dal callback Marketplace ([T-202](../plans/save2repo-tasks.md#t-202-marketplace-callback-handler--provisioning-logic-full-zero-touch)) senza che il buyer apra Supabase Studio:

1. Abilitare il provider GitHub
2. Settare Client ID + Client Secret = credenziali OAuth App `save2repo` ([T-A05](../plans/save2repo-tasks.md#t-a05-centralize-oauth-app-save2repo-credentials-github--supabase))
3. Settare Site URL = deployment URL del save2repo del buyer
4. Aggiungere il deployment URL ai Redirect URLs allowlist

## Method

1. Ispezione del source code GoTrue (`internal/api/admin.go`) per identificare gli endpoint del project-level admin API (Option A)
2. Search dei docs Supabase Management API (Option B)
3. Search dei pattern Supabase Integration per shortcut Vercel Marketplace (Option C esplorativa)

**NON testato empiricamente:** esecuzione `curl PATCH /v1/projects/{ref}/config/auth` con body completo su un project test. Confirmation dello schema body è blocking pre-T-202 implementation (vedi §Empirical follow-up).

## Findings

### Option A — DEAD: GoTrue admin endpoint via `SUPABASE_SERVICE_ROLE_KEY`

L'admin API project-level di GoTrue (`/auth/v1/admin/*`) è **strictly limited to user & identity management**:

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/users` | List users |
| GET/PATCH/DELETE | `/admin/users/{id}` | User CRUD |
| POST | `/admin/users` | Create user |
| GET | `/admin/users/{id}/factors` | List MFA factors |
| PATCH/DELETE | `/admin/users/{id}/factors/{factor_id}` | Factor CRUD |

Source: [supabase/auth `internal/api/admin.go`](https://github.com/supabase/auth/blob/master/internal/api/admin.go).

**Nessun endpoint per:** provider config (enable/disable, client_id/secret), Site URL, Redirect URLs allowlist.

→ **`SUPABASE_SERVICE_ROLE_KEY` non può scrivere config provider.** L'auto-inject di `SERVICE_ROLE_KEY` da Vercel-Supabase integration (riferimento ADR-007) è inutile per questo scopo.

### Option B — VIABLE: Supabase Management API

Endpoint documentato:

```
PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
Authorization: Bearer <supabase_access_token>
```

Reference: [Management API — Updates a project's auth config](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

**Auth requirement:** access token Supabase (account-level), ottenibile in due modi:
- **Personal Access Token (PAT)**: scoped ai progetti del PAT owner / delle sue org. Non grant access a progetti del buyer in org del buyer. ❌ inutile per save2repo install di terzi
- **OAuth flow**: esplicito user consent; produce access_token + refresh_token scoped ai progetti dell'utente che ha consentito. ✅ unica via per accedere a un project del buyer

### Option C — NOT VIABLE: Vercel Marketplace shortcut

Investigato se l'integration Vercel-Supabase native (che auto-installa Supabase nel team del buyer per ADR-007) esponga programmaticamente un Management API token alle altre integration Marketplace nel medesimo team. **No documentazione lo supporta.**

Docs Supabase ([Build a Supabase OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)) sono espliciti: *"the only method described for obtaining a Management API access token is through the OAuth2 flow with explicit user consent"*. Nessuna menzione di tunnel via Vercel.

## Conclusion

**Solo Option B è viable.** Richiede aggiungere uno step Supabase OAuth al chain dell'install callback Marketplace.

**Impact su ADR-007:** ADR-007 aveva esplicitamente rigettato di aggiungere Supabase OAuth nel flow ("Cons: 3 OAuth totali: Vercel + GitHub + Supabase = troppo"). Con Option B come unica path per zero-touch Auth config, ADR-007 va emendato.

UX trade-off: 1 extra Supabase OAuth consent (combinabile con la Supabase install redirect, dato che entrambi servono in sequenza) → si ottiene zero buyer-manual Auth config in Studio.

## Recommendation

Adottare Option B. Decisione formalizzata in [ADR-011](../decisions/ADR-011-supabase-auth-config-write-strategy.md).

## Empirical follow-up — blocking pre-T-202

Confermare empiricamente lo schema body di `PATCH /v1/projects/{ref}/config/auth` prima di disegnare T-202. Body schema best-effort dedotto dai docs (da verificare):

```http
PATCH /v1/projects/{ref}/config/auth
Authorization: Bearer <oauth_access_token>
Content-Type: application/json

{
  "external_github_enabled": true,
  "external_github_client_id": "Ov23...",
  "external_github_secret": "...",
  "site_url": "https://<buyer-deployment>.vercel.app",
  "uri_allow_list": "https://<buyer-deployment>.vercel.app/**,https://<buyer-custom-domain>/**"
}
```

(Field naming probabilmente snake_case flat; doc Management API non mostra inline schema esempio del body — va verificato col vero PATCH.)

**Passi del test empirico (da fare prima di T-202):**
1. Creare un Supabase project test ephemeral (org `save2repo`, region eu-central-1, free tier)
2. Generare un Supabase PAT del proprietario del project (sufficiente per il test; il production flow userà OAuth)
3. Eseguire la curl PATCH con il body sopra; ricevere 200
4. Verificare su Studio (Authentication → Providers → GitHub mostra enabled + client_id corretto; URL Configuration mostra Site URL + Redirect URL)
5. Fare login GitHub dal client save2repo → success senza intervento manuale
6. Rectificare il body schema in T-202 spec se field naming differisce

Il test sblocca T-202 design; non blocca T-A05/T-A06 che possono procedere in parallelo.

## References

- [GoTrue admin.go source](https://github.com/supabase/auth/blob/master/internal/api/admin.go)
- [Supabase Management API — Update auth service config](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Supabase — Build an OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [Supabase — Authorize user through oauth and claim a project](https://supabase.com/docs/reference/api/v1-oauth-authorize-project-claim)
- ADR-007 (da emendare)
- ADR-011 (output di questo spike)
