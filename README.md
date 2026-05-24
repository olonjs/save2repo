# save2repo

A multi-tenant CMS distributed as a Vercel Native Integration. Install it on
your own Vercel team via the Marketplace; from your deployment you manage N
tenant sites whose content lives in your GitHub repos (no centralized storage
on our side). AI agents can edit your content natively via MCP and A2A
protocols.

Source-available under [BUSL 1.1](LICENSE). Commercial use requires an active
subscription via the Vercel Marketplace.

## What you get

- **CMS dashboard** to manage all your tenant sites in one place
- **Save → commit → live** flow: every change is a commit to the tenant repo
  (no separate content store), Vercel auto-rebuilds the site
- **MCP server per tenant** so AI agents (Claude, ChatGPT custom GPT, custom
  A2A peers) can read and write content using machine-standard interfaces
- **Custom domains** via Vercel domains API on whatever DNS provider you use
- **Zero centralized cost of CMS**: you pay only the Vercel + Supabase you
  already pay for, plus the save2repo subscription via Vercel native billing

## Quick start

1. Install save2repo from the [Vercel Marketplace](https://vercel.com/integrations/save2repo)
   on your team. The install auto-forks the source into your GitHub and deploys
   it as a new Vercel project of yours.
2. The install guides you to add the [Supabase integration](https://vercel.com/integrations/supabase)
   and to install the [`olonjs` GitHub App](https://github.com/apps/olonjs) on
   your account if they are not present yet.
3. Open your save2repo URL, log in with GitHub, and create your first tenant
   from one of the templates.

## Architecture decisions

All architectural decisions live in [`docs/decisions/`](docs/decisions/README.md).
The implementation plan is in [`docs/plans/save2repo-plan.md`](docs/plans/save2repo-plan.md).
The product spec is in [`docs/specs/save2repo.md`](docs/specs/save2repo.md).

## Development

```bash
npm install --ignore-scripts       # supabase CLI postinstall is UNC-incompatible
cp .env.example .env.local         # fill the values
npm run dev                        # next dev on port 3000
npm run lint
npm run build
npm run type-check
```

See [CLAUDE.md](CLAUDE.md) for the project conventions an AI agent should
follow.

## Deploying the showcase (Phase 0)

For the public showcase deployment we run from our own team — the
Marketplace install flow (Phase 2) is its own thing. To set it up the first
time:

1. **Supabase test project**: create a new project in the Olon Supabase org.
   Enable the `pgsodium` and `pgcrypto` extensions (Database → Extensions),
   then apply `supabase/migrations/00000000000000_save2repo_baseline.sql`
   via the Supabase SQL editor or `supabase db push`.
2. **Vercel project**: push this branch to GitHub (`git push -u origin main`),
   then `vercel link` (Olon team) and `vercel --prod` for the first deploy.
   Subsequent pushes to `main` deploy automatically via the
   `git.deploymentEnabled.main` setting in `vercel.json`.
3. **Env vars on the Vercel project** (Settings → Environment Variables,
   "Production" scope unless noted):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` — auto-injected if you
     add the [Supabase Marketplace integration](https://vercel.com/integrations/supabase),
     otherwise paste from the Supabase project Settings → API
   - `SAVE2REPO_DEPLOYMENT_TOKEN` — for the showcase, generate any random
     32-char string (the real token comes from the Marketplace callback)
   - `OLONJS_API_BASE` — defaults to `https://app.olon.it/api/v1`
4. **GitHub App `olonjs`** installed on the Olon GitHub org with access to the
   `olonjs/*` template repos (already done; if missing, install at
   `https://github.com/apps/olonjs`). **Note:** this is the server-to-server
   GitHub App used for repo fork + commit save flow (ADR-006). It is *not*
   the same as the OAuth App used for user login (see step 5 below).
5. **OAuth App `save2repo` for user login** — distinct from the `olonjs`
   GitHub App above (see ADR-009 §"OAuth App dedicata vs GitHub App olonjs"):
   - On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
     Application name: `save2repo`. Homepage URL: the deployment URL of
     this save2repo. **Authorization callback URL:**
     `https://<supabase-ref>.supabase.co/auth/v1/callback`
     (replace `<supabase-ref>` with the ref of the Supabase project from
     step 1, e.g. `https://rksmblpvrafygdtnvjzt.supabase.co/auth/v1/callback`).
   - Copy the resulting Client ID + Client Secret.
   - In Supabase Studio → Authentication → Providers → GitHub: enable the
     provider and paste the Client ID + Client Secret from the previous
     bullet. Save.
6. Visit the deployment URL; the first request triggers the auto-migrate
   bootstrap (T-102) and then redirects to the GitHub login. The OAuth
   consent screen must show "save2repo" (not "olonjs") — if it shows
   "olonjs" your Supabase provider is still wired to the wrong OAuth App.

> **Local build on Windows + WSL** is known-broken because turbopack
> mis-evaluates the UNC root path. Use the CI/Vercel Linux build instead
> (`.github/workflows/ci.yml`) or run inside the WSL filesystem with native
> Node (not the Windows nvm4w one).

## License

[BUSL 1.1](LICENSE). Becomes Apache 2.0 four years after each release.
