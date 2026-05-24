# Spec: Cloudflare subdomain support

## Objective
Estendere il flow CF della platform per gestire correttamente i domini che sono sottodomini (es. `radice.olon.it`), non solo apex (es. `olon.it`). Quando l'utente collega un subdomain:
- Se l'apex registrabile è già una zona CF nel nostro account → adottiamo la parent zone e gestiamo solo i record DNS scoped al subdomain.
- Se l'apex registrabile non è nell'account CF → errore esplicito con istruzioni (HTTP 409 `ERR_CF_PARENT_ZONE_NOT_FOUND`).

**Success:**
- `radice.olon.it` su tenant A, `marketing.olon.it` su tenant B, entrambi condividono `cf_zone_id` della parent `olon.it`; ognuno vede e gestisce solo i propri record.
- Subdomain con apex non su CF rifiutato con messaggio chiaro.
- Delete di tenant con subdomain non distrugge la parent zone se altri tenant la condividono.

## Tech Stack
Invariato (Next.js 16, Supabase, CF API v4). +1 dep: `tldts` (PSL).

## Commands
Nessun nuovo comando. `npm run build`, `npm run lint`, `npm run test:domains:cf`.

## Project Structure
- `src/lib/domainParsing.ts` → nuovo helper `parseDomain()` (PSL wrapper)
- `src/lib/cloudflareApi.ts` → invariato (findZoneByName già esiste)
- `src/lib/tenantDeletion.ts` → modifiche per shared-zone protection
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-bootstrap/route.ts` → branch subdomain
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/route.ts` → scoping records
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/[recordId]/route.ts` → scoping records
- `supabase/migrations/<ts>_tenant_domains_cf_zone_apex.sql` → migration additiva

## Code Style
Invariato (auth + correlation + governance + Zod). Helper PSL:
```ts
import { parse } from "tldts";

export type ParsedDomain = {
  fqdn: string;        // normalized lowercase (es. "radice.olon.it")
  apex: string;        // registrable apex (es. "olon.it")
  isSubdomain: boolean;
};

export function parseDomain(input: string): ParsedDomain {
  const fqdn = input.trim().toLowerCase().replace(/\.$/, "");
  const result = parse(fqdn);
  const apex = result.domain ?? fqdn;
  return { fqdn, apex, isSubdomain: apex !== fqdn };
}
```

## Testing Strategy
- `parseDomain` unit-testabile in `scripts/cf-domains-test.mjs` con casi: apex (`olon.it`), subdomain semplice (`a.olon.it`), multi-label TLD (`bbc.co.uk`), nested subdomain (`a.b.olon.it`).
- Integration: stesso script E2E esistente esteso con un caso subdomain (env opzionale `CF_TEST_SUBDOMAIN`).

## Boundaries

**Always:**
- Tutti i path attuali del cf-bootstrap continuano a funzionare (apex pulito).
- Migration additiva, mai destructive.
- Scoping records: filtro server-side, non solo UI-side.

**Ask first:**
- Cambi alla logica platform_managed (l'algoritmo attuale già funziona per subdomain perché lavora sul `domain` come riferimento — da validare).
- Comportamento se la parent zone esiste ma è in stato CF non-`active` (penso: ereditiamo `cf_status='pending_ns'` finché parent non è active).

**Never:**
- Cancellare una zona CF condivisa da più tenant.
- Permettere create/patch/delete di record DNS fuori scope del subdomain del tenant.
- Aggiungere altri provider PSL (`psl`, `tld-extract`, ecc.) — un solo wrapper.

## Success Criteria
- [ ] `parseDomain('radice.olon.it')` → `{ apex: 'olon.it', isSubdomain: true }`
- [ ] `parseDomain('bbc.co.uk')` → `{ apex: 'bbc.co.uk', isSubdomain: false }`
- [ ] POST cf-bootstrap su `radice.olon.it` con `olon.it` su account CF → adopt parent, `cf_zone_apex='olon.it'`
- [ ] POST cf-bootstrap su `radice.example-not-in-cf.com` → 409 `ERR_CF_PARENT_ZONE_NOT_FOUND`
- [ ] GET `/dns` su tenant con subdomain → restituisce SOLO record con `name === fqdn || name.endsWith('.' + fqdn)`
- [ ] POST `/dns` con `name='altro.olon.it'` su tenant `radice.olon.it` → 403 `ERR_CF_RECORD_OUT_OF_SCOPE`
- [ ] PATCH/DELETE su record fuori scope → 403 stesso codice
- [ ] DELETE tenant con subdomain + altro tenant condivide la zona → zona CF NON cancellata, response marca `skipped_shared`
- [ ] DELETE tenant ultimo a usare la zona → zona CF cancellata regolarmente

## Open Questions
- **Library PSL**: `tldts` (proposto) o altro?
- **Parent zone in stato pending_ns/error**: eredita subdomain `cf_status='pending_ns'` o errori? (Proposta: eredita, evita race con apex appena bootstrappato)
