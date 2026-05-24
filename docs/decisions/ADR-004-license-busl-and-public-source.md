# ADR-004: License BUSL 1.1 + repo pubblico license-gated

## Status
Accepted

## Date
2026-05-24

## Context
Save2repo è venduto come subscription via Vercel Marketplace (vedi [ADR-003](ADR-003-vercel-marketplace-native-integration-billing.md)). Il source code deve essere:
- Pubblico e ispezionabile (per build trust con il buyer ICP dev tech-savvy + per consentire al Vercel Integration di accedere al template durante install)
- Protetto contro la rivendita as-a-service da parte di competitor
- Compatibile con i terms Marketplace Vercel (l'EULA del vendor non deve infringere terzi, Sec 3.4)

## Decision
**License: BUSL 1.1** (Business Source License) con:
- *Additional Use Grant*: "you may use the Licensed Work to operate any number of CMS deployments and tenants you own or manage on behalf of clients" (l'agenzia che gestisce siti per clienti finali è coperta)
- *Use Limitation*: "you may not provide save2repo as a hosted service to third parties" (blocca rivendita SaaS)
- *Change Date*: 4 anni dalla release di ogni versione
- *Change License*: Apache 2.0

**Repo visibility:** pubblico su GitHub, license-gated (uso commerciale subordinato a subscription Marketplace attiva).

## Alternatives Considered

### Elastic License v2
- Pros: source-available, simile a BUSL
- Cons: più rigida (no removing branding/protection), nessun change date → no path to FOSS
- Rejected: meno calzante; nessun benefit FOSS per la community

### Proprietary EULA con source-available clause
- Pros: massima protezione commerciale
- Cons: scoraggia ispezione e contribuzioni; in contraddizione con la trasparenza pubblica che vogliamo per build trust
- Rejected: il prodotto deve essere ispezionabile da chi compra

### Commons Clause + Apache 2.0
- Pros: combinazione popolare
- Cons: Commons Clause non OSI-recognized → genera sfiducia in dev community; BUSL ottiene lo stesso effetto con migliore reputazione
- Rejected: BUSL strictly dominant

### Sustainable Use License (n8n)
- Pros: bilancia personal/business use
- Cons: troppo permissivo per il modello pay-to-install ricorrente; non blocca chiaramente la rivendita SaaS
- Rejected: gap nelle restrizioni commerciali

## Consequences
- Standard noto e battle-tested: HashiCorp (Terraform fino a 2023), MariaDB, Sentry, CockroachDB → zero attrito di trust per il buyer ICP
- Wording specifico (Additional Use Grant, Use Limitation precise) richiede review legale prima del Marketplace submission
- BUSL accettata come EULA dal Marketplace Vercel (verificato: Sec 2.4 dell'Agreement non restringe i tipi di license)
- Path to OSS dopo 4 anni → goodwill community a lungo termine; le versioni vecchie diventano Apache 2.0, le nuove restano protected
- File `LICENSE` nel repo + URL EULA pubblica per il listing Marketplace

## References
- [Business Source License 1.1 (SPDX)](https://spdx.org/licenses/BUSL-1.1.html)
- [Integrations Marketplace Agreement Sec 2.4 – Vercel](https://vercel.com/legal/integrations-marketplace-agreement)
