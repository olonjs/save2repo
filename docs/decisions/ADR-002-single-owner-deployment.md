# ADR-002: Single-owner deployment

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo viene installato dal buyer nel suo team Vercel. Il buyer è un dev tech-savvy che gestisce 5–50 siti tenant per sé o per i propri clienti finali. I clienti finali del buyer (eventuali) ricevono i siti pronti — non accedono al CMS.

Il pattern multi-utente del parent jsonpages-platform (N user che condividono una platform, con RLS tenant-isolation per dati) è sovradimensionato per questo modello: introduce complessità (multi-tenant access control, role hierarchy, invites) senza valore per l'ICP target.

## Decision
Single-owner deployment: il buyer è l'unico user del proprio save2repo. Nessun multi-user, nessun invite system, nessun role hierarchy. La tabella `users` contiene 1 sola riga (il buyer). I `tenants` hanno `owner_user_id` FK al buyer.

## Alternatives Considered

### Multi-user con ruoli (admin / editor / viewer) come jsonpages-platform
- Pros: scala a team del buyer (es. agenzia con N dipendenti); abilita futuri use case
- Cons: complessità sostanziale (auth flow, invite system, role-based access, RLS multi-tenant); non richiesto dall'ICP target (dev singolo, dev shop con 1 owner tecnico, founder)
- Rejected: feature in cerca di un caso d'uso al day-1; può essere aggiunta post-launch se emerge demand

### Multi-tenant per clienti finali del buyer (cliente finale entra nel CMS)
- Pros: il buyer offre "self-service editing" ai suoi clienti finali
- Cons: contraddice il posizionamento ("AI agents come editor primario", non "human end-user che edita il CMS"); cambia modello security e billing
- Rejected: out of scope per il CMS-via-agenti pitch

## Consequences
- Schema Supabase semplificato: 1 user, N tenants posseduti dall'user
- RLS policies minimali (owner-only access)
- `serverAuth` adattato a single-owner check (no `assertTenantAccess` multi-role del parent)
- Auth flow ridotto: il buyer si autentica e diventa direttamente owner (no signup flow, no invitation flow)
- Future possibilità di multi-user va trattata come breaking change, ADR successivo
- Coerente con auth single-provider (vedi [ADR-009](ADR-009-auth-github-oauth-hardcoded.md))
