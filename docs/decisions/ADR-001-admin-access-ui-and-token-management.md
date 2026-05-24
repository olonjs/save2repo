# ADR-001: Admin Access UI and Token Management in Platform Dashboard

## Status
Superseded by ADR-002

## Date
2026-05-13

## Context
I tenant OlonJS deployati su Vercel espongono una route `/admin` protetta da
Vercel Edge Middleware con bearer token (vedi ADR-005 in `tenant-alpha`).

`jsonpages-platform` è la dashboard da cui l'operatore gestisce i tenant. Servono
due cose:
1. Un punto di ingresso per aprire lo Studio del tenant autenticandosi
2. Un luogo dove configurare e memorizzare il token di accesso per quel tenant

## Decision

### Tab Overview — Bottone ADMIN
Nella tab "Overview" della pagina progetto, un bottone `ADMIN` che:
1. Legge il token configurato per quel tenant dal record progetto (DB/store platform)
2. Apre `<tenantUrl>/admin` in una nuova tab tramite un redirect server-side
   (o fetch con header, seguito da redirect) che inietta `Authorization: Bearer <token>`

**Meccanismo tecnico:** Poiché i browser non permettono di aprire una URL in nuova
tab con header arbitrari via `window.open`, il flusso è:
- Platform chiama il proprio backend: `POST /api/projects/:id/admin-access`
- Il backend restituisce un URL firmato temporaneo (o esegue un redirect con cookie
  di sessione)
- Alternativa più semplice: la platform apre direttamente `<tenantUrl>/admin` e il
  middleware accetta anche un `?token=<value>` come query param (oltre all'header),
  così `window.open(url + '?token=...')` funziona

La scelta tra header vs query param viene rimandata all'implementazione; l'ADR
accetta entrambe e rimanda la decisione al task di implementazione.

### Tab Settings — Card "Admin Access"
Una card nella sezione Settings del progetto con:
- Campo input (masked) per inserire/aggiornare il token di accesso admin del tenant
- Bottone "Save" che persiste il valore nel record progetto
- Il valore salvato è usato dal bottone ADMIN in Overview
- Warning visivo se il campo è vuoto ("Admin access not configured")

Il token è memorizzato nel record progetto in platform — non nel tenant. Il tenant
ha il suo `ADMIN_TOKEN` come env var Vercel; la platform memorizza il corrispondente
valore pubblico per poterlo inviare come bearer.

## Alternatives Considered

### Bottone ADMIN nella navbar globale
- Pro: sempre accessibile
- Contro: ambiguo se ci sono più tenant — quale admin apre?
- Rifiutato: il bottone ha senso solo nel contesto di uno specifico progetto

### Token gestito direttamente nelle env var Vercel tramite API
- Pro: unica source of truth
- Contro: richiede Vercel API integration, scope e permissions complessi,
  token di accesso Vercel da gestire
- Rifiutato: complessità sproporzionata per v1; si può aggiungere in futuro

### Accesso admin senza token (link diretto)
- Pro: zero configurazione
- Contro: rimuove il valore della protezione Edge Middleware
- Rifiutato: contraddice il requisito di sicurezza

## Consequences
- L'operatore deve configurare manualmente il token nella card Settings dopo aver
  impostato `ADMIN_TOKEN` su Vercel — due step separati, fonte potenziale di desync
- Se il token in platform e il token su Vercel divergono, il bottone ADMIN restituisce
  401 (comportamento atteso, non silenzioso)
- Il token è memorizzato in platform in forma leggibile (non hash) perché deve essere
  inviato come bearer — implicazione: la sicurezza del DB platform è rilevante
- Per v1 non c'è rotazione automatica del token; va ruotato manualmente se compromesso

## See Also
- ADR-005 in `npm-jpcore/apps/tenant-alpha` — Edge Middleware sul tenant
