# ADR-008: Custom domains via Vercel API (no Cloudflare automation day-1)

## Status
Accepted

## Date
2026-05-24

## Context
Il buyer di save2repo gestisce 5–50 siti tenant. Senza custom domain support, ogni sito sarebbe esposto solo via `*.vercel.app` — non realistico per produzione. Custom domains sono in scope day-1.

Jsonpages-platform parent ha sia:
- **Stack custom domain via Vercel API** (`vercelDomains.ts`, `customDomains.ts`, `domainParsing.ts`, `domainTelemetry.ts`)
- **Stack Cloudflare-specific automation** (`cloudflareApi.ts`, routes `cf-bootstrap` / `cf-disconnect` / DNS records CRUD / DLQ `internal/domains/**`, migrations `tenant_domains_cloudflare` + `cf_zone_apex`)

Il Cloudflare automation è valore per power-users che vogliono gestione DNS programmatica via Cloudflare API; non è essenziale per il use case base (mappare un dominio del buyer a un tenant).

## Decision
- **Custom domains via Vercel domains API** = preservato dal parent e adattato (token Vercel del buyer)
- **Cloudflare-specific automation** = rimosso dal fork; il buyer fa il DNS setup sul suo registrar/provider (Cloudflare, Route53, Google Domains, Namecheap — qualunque), save2repo guida con verify standard
- Reintroduzione di Cloudflare automation = feature post-launch eventuale, ADR successivo

## Alternatives Considered

### Includere Cloudflare automation day-1
- Pros: power-users contentissimi; automation completa zone + DNS records
- Cons: stack non banale (Cloudflare API client + zone adoption + DLQ + DNS records CRUD); il buyer deve avere Cloudflare account e configurare `CLOUDFLARE_API_TOKEN` env; aggiunge 8+ file da debug-are al day-1; valore marginale basso (un setup CNAME via UI registrar è 30 secondi)
- Rejected: scope creep; ROI basso al day-1 vs costo di mantenimento

### No custom domains day-1, solo `*.vercel.app`
- Pros: scope minimo
- Cons: il prodotto non è utilizzabile in produzione → success criterion ("use funnel self-serve, primo save reale") fallisce
- Rejected: contraddice il valore base del CMS

## Consequences

**Routes preservate:**
- `src/app/api/v1/tenants/[id]/domains/route.ts`
- `src/app/api/v1/tenants/[id]/domains/[domain]/route.ts`
- `src/app/api/v1/tenants/[id]/domains/[domain]/verify/route.ts`

**Routes rimosse:**
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-bootstrap/route.ts`
- `src/app/api/v1/tenants/[id]/domains/[domain]/cf-disconnect/route.ts`
- `src/app/api/v1/tenants/[id]/domains/[domain]/dns/**`
- `src/app/api/v1/internal/domains/**` (DLQ, reconcile, events, metrics)

**Lib preservato:** `src/lib/vercelDomains.ts`, `customDomains.ts`

**Lib rimosso:** `src/lib/cloudflareApi.ts`, `domainParsing.ts` (era CF-specific con tldts), `domainTelemetry.ts` (era CF-specific)

**Migrations:** `tenant_domains_enterprise` preservata; `tenant_domains_cloudflare` e `tenant_domains_cf_zone_apex` non vengono nel fork

**UI domains tab del tenant** guida: "Aggiungi dominio → punta CNAME a `cname.vercel-dns.com` (o A record a `76.76.21.21`) sul tuo registrar"
