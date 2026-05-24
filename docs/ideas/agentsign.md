# AgentSign — Sigstore for AI Agents

> **Status:** Idea (Phase 3 — refined one-pager)
> **Date:** 2026-04-25
> **Author:** Refined via `/idea-refine` from an earlier ADR draft ("OlonOS Bare-Metal & Trust Layer")
> **Origin seed:** *"Un device in cui la app è un agente, scritto in JS, con un OS tipo ChromeOS, e un registro immutabile degli agenti per identificarsi tra loro."*

---

## Problem Statement

> **How might we make AI agent identity, integrity, and provenance verifiable across frameworks and runtimes — without forcing a walled garden?**

Today AI agents (MCP servers, A2A agents, custom JS agents) are downloaded from npm / PyPI / arbitrary registries and executed with elevated permissions (filesystem, shell, browser, API keys) **without any identity or integrity verification**. A malicious MCP server is, effectively, a reverse shell. There is no "Sigstore for agents" — and 2026 is the right window to build one, before the inevitable supply‑chain incident.

---

## Recommended Direction

**Three components, JS‑first, drop‑in for every framework:**

1. **`agentsign` CLI** — signs agent artifacts (MCP servers, A2A bundles, any JS package marked as an agent) using OIDC identity (GitHub, Google, org SSO) via Fulcio. No long‑lived key management.
2. **Transparency Log** — append‑only Merkle log (Rekor‑derived), federation‑ready. Every signature is publicly verifiable; no one (including us) can rewrite history.
3. **`@agentsign/verify` SDK** — three lines of code so Mastra, LangChain JS, Vercel AI SDK, MCP runtimes, etc. can verify *before* loading.

**Differentiation vs vanilla Sigstore.**
Sigstore signs *static binaries*. Agents are *active*: they declare capabilities, request permissions, talk to each other. AgentSign adds **signed Capability Attestations** — not just "this is the real code", but also "this agent declares it accesses only `fs:read /tmp` and `net:openai.com`". The hosting runtime can deny automatically if the running agent tries to exceed its manifest. *That* is the novelty over Sigstore.

**Wedge:** **MCP server signing.** Win MCP in 2026, expand to A2A in 2027, cover all agent artifacts by 2028.

**Positioning:** *"The Switzerland of AI agent identity."* Neutral, open, no token, built on Sigstore primitives, governed independently → CNCF donation at 12 months.

---

## Key Assumptions to Validate

- [ ] **A1 — Demand.** The MCP community wants signing.
  *Test:* 10 interviews with top MCP server maintainers, scan GitHub issues, poll on Anthropic/MCP Discord.
- [ ] **A2 — Adoption.** A neutral framework gets adopted drop‑in.
  *Test:* one principle‑level commitment from Mastra **or** LangChain JS **or** Vercel AI SDK within 60 days.
- [ ] **A3 — Willingness to pay.** Five enterprises pay for private verification + SLA + compliance reporting.
  *Test:* five calls with security/CISO at banks / healthcare / gov.
- [ ] **A4 — Capability attestations.** They are the right differentiation (not just "fancy hashes").
  *Test:* prototype + demo to 5 framework authors, measure enthusiasm.
- [ ] **A5 — Neutrality wins.** A non‑walled‑garden trust layer beats Anthropic/OpenAI rolling their own.
  *Test:* signal of interest from CNCF, Linux Foundation, OpenSSF within 90 days.

---

## MVP Scope (3–6 months)

**In scope:**
- CLI: `agentsign sign ./my-mcp-server` → OIDC sign + push to log
- Transparency log self‑hosted (Rekor fork or Trillian‑based)
- JS verifier SDK (`verify(agentManifest) → ok | reason`)
- Reference integration: **a fork of one popular MCP runtime** that verifies on load
- v0 spec of the agent manifest (identity + hash + capability claims)
- Documentation + 3 end‑to‑end demos

**Out of MVP (v2+):**
- Multi‑log federation
- Runtime capability *enforcement* (v1 is *declaration* only, v2 is enforcement)
- GUI / dashboard
- Python SDK
- Reputation / scoring

---

## Not Doing (and Why)

- ❌ **OS, kernel, init, display server** — that was the original ADR's mistake. Build on existing runtimes.
- ❌ **Blockchain / token / Hedera / HBAR** — Sigstore/Rekor prove that append‑only does not require crypto. No token = no friction = no regulatory mess.
- ❌ **A new JS runtime** — use Node / Deno / Bun. We are a library, not a platform.
- ❌ **A new agent framework** — be **Switzerland**. Work with all of them.
- ❌ **Python on day 1** — JS wedge first. Python comes when there is traction.
- ❌ **Reinvent OIDC / Fulcio** — reuse existing identity (GitHub, Google, org SSO).
- ❌ **A consumer GUI** — day‑1 user is the *framework author* and the *enterprise security engineer*, not the consumer.
- ❌ **Solve "agent reputation"** — that is the *next* problem, not the first. Identity + integrity before reputation.

---

## Open Questions

1. **Build on top of Sigstore or fork?** *Tentative answer:* **on top.** Inherit the trust of CNCF‑graduated Sigstore, contribute the agent‑specific primitives upstream (capability attestations). Ship in 3 months instead of 12.
2. **Governance.** CNCF project? OWASP? Independent foundation? *Tentative answer:* **start independent, donate to CNCF at 12 months** when there is traction. Critical for "Switzerland" credibility.
3. **Monetization.** Hosted private log for enterprise + compliance reports + insurance partnership? GitHub model (free tier + enterprise paid). **Do not sell the protocol, sell the guarantee.**
4. **Naming.** AgentSign / AgentTrust / Provenance / OlonSign? Test in dev market — but avoid the "Olon" prefix if cross‑ecosystem adoption is the goal (sounds proprietary).
5. **Relationship with Anthropic / MCP team.** Notify and seek co‑design, or ship and ask forgiveness? *Tentative answer:* **notify**. Anthropic gains everything if MCP becomes "secure by default" and has no internal bandwidth to do it.

---

## Tailwinds (why *now*)

- **MCP** adopted by Anthropic, OpenAI, Microsoft, Cursor — thousands of public servers, **zero trust layer**.
- **Sigstore** has won the container / npm / PyPI battle → model validated.
- **xz backdoor (2024) + SolarWinds + log4j** → CISOs have dedicated supply‑chain budgets.
- **AI agents = code execution with LLM autonomy** → the worst attack surface ever shipped to users.
- **No direct competitor today** (sanity check: search "MCP signing", "agent provenance", "AI supply chain"). Window probably 12 months.

## Real Risks

- **Anthropic rolls their own** inside the MCP spec. *Mitigation:* move fast, propose co‑design, contribute the spec to MCP.
- **Nobody cares** until a famous malicious MCP server goes public. *Mitigation:* the enterprise compliance sale does not wait for the incident.
- **Sigstore itself extends** to AI agents. *Mitigation:* be the AI subset of Sigstore — collaborate instead of compete, become the maintainer of the agent‑specific subset.

---

## Next 3 Concrete Steps

1. **Validate A1 in one week.** Ten DMs to top MCP maintainers + one thread on X / MCP Discord.
2. **Tech spike in two weeks.** Prototype CLI signing an MCP server with cosign, verifying it on load in a forked runtime.
3. **Landing page + v0 manifesto** to measure signal (waitlist + GitHub stars on the spec repo).

---

## Provenance of this Document

- Originated from a draft ADR proposing **OlonOS** (custom Linux + Rust supervisor + V8 isolates + Hedera HCS + Wayland kiosk).
- Refined via the `/idea-refine` skill: stripped premature implementation choices, isolated the *real* unmet need (verifiable agent trust), and reframed it as infrastructure rather than as an OS.
- Three directions were considered (full OS · trust layer SDK · browser fork). **Trust layer SDK** chosen as the most defensible, most capital‑efficient, fastest‑to‑market direction for 2026.
