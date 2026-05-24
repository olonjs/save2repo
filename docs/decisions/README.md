# Architecture Decision Records (ADR)

Decisioni architettoniche di save2repo. Ogni file cattura: contesto, decisione, alternative considerate, conseguenze.

**Convenzione naming:** `ADR-NNN-kebab-titolo.md` con NNN sequenziale.

**Status lifecycle:** `Proposed → Accepted → (Superseded | Deprecated)`. Le ADR non vengono cancellate; quando una decisione cambia si scrive una nuova ADR che referenzia e supersede la vecchia.

## Index

| # | Titolo | Status |
|---|---|---|
| [ADR-001](ADR-001-fork-from-jsonpages-platform.md) | Fork separato da jsonpages-platform | Accepted |
| [ADR-002](ADR-002-single-owner-deployment.md) | Single-owner deployment | Accepted |
| [ADR-003](ADR-003-vercel-marketplace-native-integration-billing.md) | Distribuzione via Vercel Native Integration + subscription billing | Accepted |
| [ADR-004](ADR-004-license-busl-and-public-source.md) | License BUSL 1.1 + repo pubblico license-gated | Accepted |
| [ADR-005](ADR-005-save-flow-repo-only.md) | Save flow = save2repo only | Accepted |
| [ADR-006](ADR-006-shared-olonjs-github-app-with-token-signing.md) | GitHub App `olonjs` condivisa + token-signing centralizzato | Accepted |
| [ADR-007](ADR-007-supabase-via-vercel-integration-guided-redirect.md) | Supabase via Vercel integration + guided redirect | Accepted |
| [ADR-008](ADR-008-custom-domains-vercel-api-only.md) | Custom domains via Vercel API (no Cloudflare automation day-1) | Accepted |
| [ADR-009](ADR-009-auth-github-oauth-hardcoded.md) | Auth = GitHub OAuth hardcoded (single provider day-1) | Accepted |
| [ADR-010](ADR-010-tenant-templates-external-olonjs.md) | Template tenant esterni in org `olonjs/*` | Accepted |
