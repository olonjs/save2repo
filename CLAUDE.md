# CLAUDE.md — save2repo

Fork attivo da jsonpages-platform (T-001 done, commit `52e4f75`). Implementation in corso secondo [docs/plans/save2repo-tasks.md](docs/plans/save2repo-tasks.md).

**Source of truth:** [docs/specs/save2repo.md](docs/specs/save2repo.md) + ADR in [docs/decisions/](docs/decisions/README.md). Leggili prima di proporre cambiamenti.

## Tech stack (ereditato da jsonpages-platform, modificato come da spec)

Next.js 16 (App Router) · React 18 · TypeScript strict · Tailwind · Supabase auth (config-driven verso il buyer's Supabase project) · GitHub App + Octokit · Vercel API client.

**Rimosso vs jsonpages-platform:** LemonSqueezy billing, `tenant_content_store`, Edge Config / hot-save (`save2edge`), custom domains + Cloudflare orchestration, provisioning flow "Full".

**Preservato come moat:** MCP gateway + admin keypair signing · A2A + webMCP · provision-stream SSE pattern (dispatcher su `deployment_target = client_vercel`) · template tenant ecosystem `olonjs/*` (esterno al repo, fetched via GitHub API).

## Dependencies, build & lint

Da WSL nativo (`dev@Studio:~/save2repo$`):

```bash
npm install --ignore-scripts        # vedi gotcha sotto
chmod +x node_modules/.bin/*        # vedi gotcha sotto
npm run dev                          # next dev
npm run build
npm run lint
npx tsc --noEmit
```

**Gotcha — npm install via Windows hand-off:** quando `npm install` viene
eseguito attraverso il bridge Windows ↔ WSL (es. un agente che chiama
`wsl -d Ubuntu bash -lc "npm install"` dalla CWD Windows), succedono due cose:

1. Il `supabase` package ha un postinstall che invoca `cmd.exe` con la CWD su
   UNC path (`\\wsl.localhost\...`), e cmd.exe non supporta UNC → l'install
   fallisce con `ERR_INVALID_URL`. Mitigation: **sempre `--ignore-scripts`**.
   Il binary `supabase` CLI non serve a runtime; chi lo vuole se lo installa
   a parte.
2. I wrapper POSIX in `node_modules/.bin/` vengono scritti con permission
   `644` (no execute bit) perché Windows npm non setta il flag eseguibile sul
   filesystem WSL. Risultato: `npm run dev` ritorna `sh: 1: next: Permission
   denied`. Mitigation: **`chmod +x node_modules/.bin/*` post-install**.

Eseguendo l'install da WSL nativo con npm nativo Linux (nvm/apt) entrambi i
problemi spariscono — il bridge Windows è la causa.

## Implementation plan

- [docs/plans/save2repo-plan.md](docs/plans/save2repo-plan.md) — Plan macro: phases, dependency graph, parallelization, risks
- [docs/plans/save2repo-tasks.md](docs/plans/save2repo-tasks.md) — 31 task granulari (XS/S/M) con acceptance, verify, files, dependencies

## Decisioni architettoniche

Fonte autoritativa: `docs/decisions/` — un file ADR per decisione, con contesto, alternative considerate e conseguenze. Index in [docs/decisions/README.md](docs/decisions/README.md).

Quick reference:
- [ADR-001](docs/decisions/ADR-001-fork-from-jsonpages-platform.md) Fork separato da jsonpages-platform
- [ADR-002](docs/decisions/ADR-002-single-owner-deployment.md) Single-owner deployment
- [ADR-003](docs/decisions/ADR-003-vercel-marketplace-native-integration-billing.md) Distribuzione Vercel Native Integration + subscription billing + trial 30gg
- [ADR-004](docs/decisions/ADR-004-license-busl-and-public-source.md) License BUSL 1.1 + repo pubblico license-gated
- [ADR-005](docs/decisions/ADR-005-save-flow-repo-only.md) Save flow = save2repo only (no hot-save, no Edge Config)
- [ADR-006](docs/decisions/ADR-006-shared-olonjs-github-app-with-token-signing.md) GitHub App `olonjs` condivisa + token-signing centralizzato
- [ADR-007](docs/decisions/ADR-007-supabase-via-vercel-integration-guided-redirect.md) Supabase via Vercel integration + guided redirect
- [ADR-008](docs/decisions/ADR-008-custom-domains-vercel-api-only.md) Custom domains via Vercel API (no Cloudflare day-1)
- [ADR-009](docs/decisions/ADR-009-auth-github-oauth-hardcoded.md) Auth = GitHub OAuth hardcoded
- [ADR-010](docs/decisions/ADR-010-tenant-templates-external-olonjs.md) Template tenant esterni in `olonjs/*`

## Memoria persistente

`~/.claude/projects/--wsl-localhost-ubuntu-home-dev-save2repo/memory/` (quando esiste).
