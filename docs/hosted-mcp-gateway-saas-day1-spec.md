# Spec: Hosted MCP Gateway (SaaS Ready Day 1)

## Objective

Build a public, multi-tenant HTTPS MCP gateway for JsonPages/OlonJS tenants that is production-safe from day 1.

Target users are paying external customers (not internal-only usage). The gateway must support enterprise-grade authentication, guarded production writes, auditable operations, and minimum operational SLOs.

Success means:
- external customers can connect via remote MCP URL over HTTPS,
- tenant boundaries are enforced for every request,
- write operations are policy-controlled and fully audited,
- service quality is measurable and monitored.

## Scope

In scope for day-1 SaaS:
- Public HTTPS MCP endpoint for remote clients.
- Multi-tenant request routing and tenant isolation.
- Authn + authz with scoped permissions.
- Read and write MCP tool execution with production guardrails.
- Audit trail and observability baseline.
- Rate limiting, quotas, and abuse protection.

Out of scope for first release:
- Marketplace-style self-serve billing automation inside gateway runtime.
- Full custom policy language.
- Region-based data residency variants.

## Assumptions (explicit)

1. The gateway is a standalone service in front of tenant operations.
2. External clients will use MCP over HTTP(S) transport supported by their tooling.
3. Production writes are allowed only with explicit role + policy grants.
4. Existing platform components (Supabase auth/storage, current API patterns) can be reused where sensible.
5. Initial launch can use a single region, with architecture prepared for future multi-region rollout.

## Tech Stack

- Runtime: Node.js + TypeScript.
- Web framework: Next.js API route handlers or dedicated Node service (final choice in Plan phase).
- Identity: OAuth/OIDC for enterprise users and scoped machine credentials.
- Data/audit store: Supabase/Postgres (or equivalent relational store).
- Queue/execution: async worker model for long-running tool calls.
- Observability: structured logs, metrics, tracing, alerting.

## Commands

Current repository baseline commands:

```bash
npm install
npm run dev
npm run build
npm run lint
```

Gateway validation commands to add in implementation phase:

```bash
npm run test:mcp-gateway:unit
npm run test:mcp-gateway:integration
npm run test:mcp-gateway:security
npm run test:mcp-gateway:load
```

## Project Structure

Proposed placement in this repo:

```text
src/app/api/v1/mcp-gateway/                 # public MCP HTTPS entrypoint(s)
src/app/api/v1/mcp-gateway/auth/            # token introspection, auth middleware
src/app/api/v1/mcp-gateway/policy/          # authz checks, write guardrails
src/app/api/v1/mcp-gateway/tools/           # tool dispatch contracts
src/app/api/v1/mcp-gateway/audit/           # append-only audit writer
src/app/api/v1/mcp-gateway/rate-limit/      # quotas and abuse protection
src/lib/mcp-gateway/                         # shared gateway domain logic
tests/mcp-gateway/                           # integration + security + load tests
docs/operations/mcp-gateway-runbook.md       # incident and operations runbook
docs/hosted-mcp-gateway-saas-day1-spec.md    # this specification
```

## API and Security Model

### Authentication (Authn)

- Human users: OAuth/OIDC (enterprise ready).
- Machine agents: short-lived scoped tokens or signed client credentials.
- No anonymous access.

### Authorization (Authz)

Permission model must include:
- `mcp:read`
- `mcp:update-section`
- `mcp:save`
- `mcp:admin`

Each permission is scoped by:
- tenant,
- environment (`staging`, `production`),
- optional page/tool restrictions.

### Production Write Guardrails

For `update-section` and `save` on production:
- require explicit production scope,
- require policy check pass (role + tenant + env),
- support optional step-up or approval mode (feature flag at launch),
- always emit immutable audit entries.

### Tenant Isolation

Every request must carry resolved tenant context and be blocked on mismatch.
Cross-tenant access is denied by default.

### Audit and Compliance Baseline

Each tool call logs:
- timestamp,
- actor identity,
- tenant id,
- environment,
- tool name,
- target slug/section where applicable,
- request id / trace id,
- decision outcome (allow/deny/error),
- sanitized payload fingerprint (not raw secrets).

Audit logs are append-only and exportable for enterprise customers.

## Reliability and SLOs

Day-1 minimum SLO targets:
- Availability: 99.9% monthly.
- Read operations (`list/read`): p95 latency < 1000 ms.
- Write operations (`update/save`): p95 latency < 3000 ms (excluding downstream deploy queue wait).
- 5xx error rate: < 0.5% daily.

Required SLI instrumentation:
- request count by tenant/tool/status,
- latency histograms by tool and env,
- auth failures vs authz denials,
- downstream dependency error rates.

## Code Style

Use strict typed boundaries and fail-closed policy checks.

```ts
type GatewayContext = {
  tenantId: string;
  env: "staging" | "production";
  actorId: string;
  scopes: string[];
};

export async function authorizeOrThrow(
  ctx: GatewayContext,
  requiredScope: string
): Promise<void> {
  const allowed = ctx.scopes.includes(requiredScope);
  if (!allowed) {
    throw new Error("forbidden");
  }
}
```

Conventions:
- explicit types at boundaries,
- deny-by-default policy logic,
- idempotency keys for write paths,
- structured logs only (no sensitive payload dumps).

## Testing Strategy

### Unit tests
- authz evaluator (allow/deny matrix),
- tenant isolation checks,
- policy guards for production writes,
- audit payload sanitization.

### Integration tests
- full tool call flow with valid and invalid tokens,
- cross-tenant access attempts,
- read-only tenant attempts to write,
- production write with and without required scope.

### Security tests
- token replay attempts,
- malformed JWT/token handling,
- rate-limit bypass attempts,
- injection and payload abuse vectors.

### Load tests
- concurrency profile for read-heavy and mixed traffic,
- p95/p99 validation vs SLOs,
- downstream timeout and retry behavior.

### Operational verification
- alert firing on SLO breach simulation,
- runbook dry run for dependency outage,
- audit export validation.

## Boundaries

- Always:
  - enforce tenant context for every request,
  - log auditable decisions for every tool call,
  - apply deny-by-default authz,
  - verify SLO telemetry in each release.

- Ask first:
  - changing auth provider/protocol,
  - modifying production write policy semantics,
  - introducing new external dependencies for security-critical paths.

- Never:
  - expose unauthenticated write endpoints,
  - allow cross-tenant fallback behavior,
  - log secrets or full sensitive payloads,
  - ship without audit trail on mutating operations.

## Success Criteria

1. External MCP clients can connect to a stable HTTPS endpoint and complete authenticated `list/read` flows.
2. Multi-tenant isolation is proven by integration tests (cross-tenant attempts denied).
3. Production writes require explicit scope and policy pass.
4. Every mutating call produces an immutable audit event with traceability.
5. Rate limiting and quota enforcement block abusive patterns.
6. SLI dashboards and alerts exist, and baseline SLOs are measured in staging before production rollout.

## Risks and Mitigations

- Risk: Browser-automation execution paths can be unstable at SaaS scale.
  - Mitigation: isolate execution workers, enforce timeouts, prioritize API-native execution migration.

- Risk: Token scope misconfiguration may over-grant writes.
  - Mitigation: explicit scope registry, deny by default, policy tests in CI.

- Risk: Noisy-neighbor tenant traffic affects reliability.
  - Mitigation: per-tenant quotas, concurrency caps, and backpressure.

## Open Questions

1. Preferred primary auth implementation for launch: full OIDC only, or OIDC + machine credentials hybrid?
2. Is production write approval mandatory for all plans, or plan-gated?
3. Should first release include dedicated audit export API or dashboard-only access?
4. Which execution model is launch-default for mutating tools: API-native only, or temporary hybrid with automation workers?
5. Which hosting topology is launch target: single-region managed service or split edge + worker architecture?

