# Spec: Cloudflare-native domain management

## Objective
Estendere il tab Domains della platform con un layer Cloudflare: all'aggiunta di un dominio si crea una zona CF, si importa la zona DNS esistente, si restituiscono gli NS da impostare al registrar; quando la delegation è attiva, appare una UI di gestione DNS (stile dashboard CF) con toggle on/off del proxy per record. Vercel rimane invariato come compute origin.

**Success:** un tenant aggiunge un dominio, riceve gli NS CF, ottiene stato `active` dopo cambio NS al registrar, e può gestire i record DNS dal nostro dashboard inclusi on/off del proxy CF.

## Tech Stack
- Next.js 16.1.6 (App Router), TypeScript ^5
- Supabase (PostgreSQL + auth)
- React 19 + Tailwind v4 + shadcn-ui
- Zod per validation
- Cloudflare API v4 (`fetch` diretto, no SDK aggiunto)

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test CF domains (nuovo): `npm run test:domains:cf`
- Test esistenti rilevanti: `npm run test:domains`, `npm run test:tenant-delete`

## Project Structure
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-bootstrap/route.ts` → create zone CF + NS
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/route.ts` → list/create record
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/[recordId]/route.ts` → update/delete record
- `src/app/api/v1/internal/domains/reconcile/route.ts` → esteso per poll `cf_status = pending_ns`
- `src/lib/cloudflareApi.ts` → wrapper API CF (analogo a `vercelDomains.ts`)
- `src/app/dashboard/components/domains/` → estensione UI + sub-UI DNS records
- `supabase/migrations/<ts>_tenant_domains_cloudflare.sql` → estensione `tenant_domains`
- `scripts/cf-domains-test.mjs` → integration test

## Code Style
Pattern del repo (auth + correlation + governance):
```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRequestUser, assertTenantAccess } from '@/lib/serverAuth';
import { resolveCorrelationId } from '@/lib/customDomains';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string; domain: string }> }) {
  const params = await context.params;
  const correlationId = resolveCorrelationId(req);
  const auth = await requireRequestUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  const access = await assertTenantAccess({ userId: auth.data.user.id, tenantId: params.id, requiredRole: 'editor' });
  if (!access.ok) return NextResponse.json({ error: access.data.error, code: access.data.code, correlationId }, { status: access.data.status });
  // ... logica
}
```
- Error codes prefix: `ERR_CF_*`
- Telemetry: `logDomain('info', 'cf.zone.created', {...})`, `metricDomain('cf_zone_created', 1, {...})`

## Testing Strategy
- Script `.mjs` in `/scripts/`, env-gated (richiede `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, test domain)
- Coverage minima: bootstrap, transizione `pending_ns → active`, CRUD record, proxy toggle, zone delete su tenant delete

## Boundaries

**Always:**
- Validare input con Zod
- Correlation ID + Idempotency-Key su mutations
- Riusare `assertTenantAccess`, `assertDomainGovernance`, `enforceDomainMutationRateLimit`
- Eventi audit in `tenant_domain_events` con `event_name = 'cf_*'`
- Cancellare la zona CF quando si cancella il tenant

**Ask first:**
- Cambi schema (`tenants` o nuove tabelle)
- Aggiunta deps in `package.json`
- Qualsiasi modifica al flow Vercel esistente
- Risoluzione delle Open Questions

**Never:**
- Storare il `CLOUDFLARE_API_TOKEN` in codice o nel DB
- Cachare i record DNS in DB (read live da CF API ogni volta)
- Toccare il flow Vercel domains attuale

## Success Criteria
- [ ] Aggiunta dominio crea zona CF e restituisce NS
- [ ] `cf_status` transiziona `pending_ns → active` automatico
- [ ] UI DNS records appare solo a `cf_status = active`
- [ ] CRUD record DNS funziona via CF API live
- [ ] Toggle proxy per-record persiste
- [ ] `DELETE /tenants/[id]` cancella anche le zone CF
- [ ] Vercel domain flow inalterato

## Open Questions (da decidere insieme prima di Plan)
- **Trigger CF bootstrap**: parte automaticamente al POST `/domains` o c'è un'azione esplicita?
- **Disconnect CF**: in MVP? Se sì, cancella zona o solo unlink?
- **Default proxy state** per nuovi record A/AAAA/CNAME creati dalla UI?
- **Quali tipi di record DNS** editabili dalla UI in MVP?
- **Record verso Vercel** (apex/www): read-only managed o editabili dal cliente?
- **Conflitto zona pre-esistente** su account CF: errore o reuse?
- **Schema preciso** dei nuovi campi su `tenant_domains` (nomi e tipi)
