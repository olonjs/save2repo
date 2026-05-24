# Cloudflare-native domain management

## Problem Statement
**How might we** offrire ai tenant un servizio integrato di DNS managed + CDN via Cloudflare, indipendente da Vercel sul layer di distribuzione/dominio, mantenendo Vercel come compute origin invariato?

## Recommended Direction
Al momento dell'aggiunta di un dominio nel tab Domains, la platform attiva un "CF bootstrap" automatico: crea la zona su Cloudflare via API e auto-importa tutti i record DNS esistenti del cliente. Restituisce i 2 nameserver CF assegnati. Il dominio resta in stato `pending_ns` finché il cliente non aggiorna gli NS al suo registrar. Quando CF rileva la delegation (zone.status = active), il dominio diventa `active` e la platform espone un editor DNS nativo nel dashboard — lista record con CRUD completo, toggle proxy per-record, audit log. Vercel continua a gestire il dominio lato suo (verifica + serving su `<tenant>.vercel.app`) senza cambiamenti.

Il proxy CF on/off è una decisione del cliente per-record: ON = traffico via CF (CDN, TLS, future WAF), OFF = grey cloud, traffico diretto all'origin Vercel. Il toggle non implica downtime né cambio NS.

## Key Assumptions to Validate
- [ ] **Auto-import zona via API**: confermare che `POST /zones` + scan automatico replica fedelmente la zona pre-esistente (MX, TXT, sub-domain) — test su 2-3 domini reali con DNS complessi
- [ ] **Latenza NS propagation**: tempo medio cliente da "cambia NS" a `cf_active` (target: < 24h, polling endpoint `zone.status`)
- [ ] **Vercel compatibility con CF in proxy**: test E2E che Vercel continua a riconoscere il dominio quando le richieste arrivano da IP CF (oggi sì, da confermare con un tenant pilota)
- [ ] **Free tier sufficiency**: zona CF gratis, ma alcuni feature (Page Rules, alcune WAF rules) sono Pro+. Modellare cosa includere all'MVP

## MVP Scope
**In:**
- Estensione tabella `tenant_domains` con campi: `cf_zone_id`, `cf_nameservers`, `cf_status` (`pending_ns` | `active` | `error`)
- Endpoint `POST /api/v1/tenants/[id]/domains/[domain]/cf-bootstrap` → crea zona CF, restituisce NS
- Polling/reconcile job per status `pending_ns` → `active`
- Tab Domains: pannello con NS da impostare + indicatore status
- Tab DNS (visibile solo se `cf_status = active`): lista record + CRUD (`GET/POST/PATCH/DELETE /api/v1/tenants/[id]/domains/[domain]/dns`)
- Toggle proxy per-record (orange/grey)
- Cleanup zona CF nel `DELETE /tenants/[id]` (estensione di `src/lib/tenantDeletion.ts`)

**Out:**
- Page Rules, Workers, WAF custom — feature successive
- Migrazione tenant esistenti — piano separato, post-MVP
- Sostituzione Vercel come compute (step AWS+SST, fase 2)
- Email DNS automation (SPF/DKIM/DMARC) — feature successive

## Not Doing (and Why)
- **Provider abstraction `DomainProvider`** — sopravvalutata per ora. Vercel resta intatto, CF è un layer additivo, non sostitutivo. Astrazione la introdurremo quando inizieremo davvero a togliere Vercel (fase AWS).
- **CF for SaaS Custom Hostnames** — modello alternativo scartato in favore della delegation completa della zona, che è gratis e dà controllo totale
- **DNS managed come opt-in separato** — è automatico quando CF è connesso, niente friction extra
- **Forzare proxy ON** — il cliente sceglie per record (come fa la dashboard CF)

## Open Questions
- **Record platform-managed**: i record che servono a Vercel (apex/www) sono read-only nella UI o editabili con warning? (default proposto: editabili con badge "managed by platform", reconcile auto rimette a posto)
- **Cleanup su delete dominio**: se cliente rimuove dominio dal tab → cancelliamo la zona CF anche se ha record custom suoi (es. MX email)? Probabilmente sì con un warning forte, ma da confermare
- **Audit log**: dove logghiamo i cambi DNS (Supabase `tenant_dns_audit`? log esterno?) — decisione product+ops
