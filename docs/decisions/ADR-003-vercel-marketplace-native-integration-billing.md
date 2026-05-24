# ADR-003: Distribuzione via Vercel Native Integration + subscription billing

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo deve essere monetizzato e distribuito al buyer ICP (dev tech-savvy già su Vercel). Decisione iniziale: "perpetua una tantum" off-Marketplace via Stripe/Gumroad + Deploy Button.

Verifica successiva della docs Vercel ha smentito la fattibilità del pattern preferito:
- `Integrations Marketplace Agreement` Sec 2.1 + Sec 6: *"Developer Applications will not be made available on the Marketplace for a fee"* + *"Developer shall not charge a fee for any of its Developer Applications"* → vieta esplicitamente fee per il pattern Connectable Account integration
- `Native Integration` permette billing, ma solo nel modello *"Customers pick plans for your products in the Vercel dashboard, and Vercel bills them through their Vercel account"* → plan-based subscription, no perpetua

## Decision
Distribuzione via **Vercel Native Integration sul Marketplace**. Modello commerciale: **subscription via Vercel native billing**. **Trial 30 giorni free**. Tier specifici (piani $/mese, tiering per N tenant, addon) finalizzati prima del Marketplace submission (ADR successivo).

## Alternatives Considered

### Vendita off-Marketplace (Gumroad / Stripe) + Deploy Button (modello originale)
- Pros: conservava "perpetua una tantum", license BUSL pulita, controllo totale del flow
- Cons: zero discovery via Vercel Marketplace; il Marketplace è il canale di acquisizione primario per l'ICP "indie hacker già su Vercel"
- Rejected: la perdita di discovery è pesata superiore al vantaggio del pricing perpetuo

### Marketplace + Connectable Account integration
- Pros: pattern OAuth standard
- Cons: vietato esplicitamente charge fee → no monetizzazione direct
- Rejected: incompatibile con qualunque modello commerciale

### Hybrid: free Marketplace listing + paid license backend
- Pros: cuce "perpetua" + discovery
- Cons: anti-pattern UX (cliente installa, scopre paywall dopo); complesso da implementare
- Rejected: scarsa UX

## Consequences
- Native Integration richiede Pro plan Vercel team (nostro)
- Implementare integration server con endpoints Marketplace API (plans, provisioning, billing) — riferimento `https://github.com/vercel/example-marketplace-integration`
- Revenue share via Vercel; payout flow da configurare nel Marketplace Console
- Subscription model significa revenue ricorrente (positivo per business sustainability)
- Decisione "perpetua una tantum" originariamente in spec è stata ribaltata; spec aggiornato
- Trial 30 giorni = il buyer prova senza commitment; metriche di conversion trial→paid da tracciare
- L'install funnel passa via Marketplace; il deploy del save2repo nel Vercel del buyer avviene nel callback handler dell'integration

## References
- [Integrations Marketplace Agreement – Vercel](https://vercel.com/legal/integrations-marketplace-agreement)
- [Create a Native Integration – Vercel](https://vercel.com/docs/integrations/create-integration/marketplace-product)
- [Marketplace Program – Vercel](https://vercel.com/marketplace/program)
