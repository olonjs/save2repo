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
npm install
cp .env.example .env.local       # fill the values
npm run dev                      # next dev on port 3000
npm run lint
npm run build
npm run type-check
```

See [CLAUDE.md](CLAUDE.md) for the project conventions an AI agent should
follow.

## License

[BUSL 1.1](LICENSE). Becomes Apache 2.0 four years after each release.
