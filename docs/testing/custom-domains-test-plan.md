# Custom Domains Test Plan

## Unit

- Validate domain normalization and syntax policy:
  - lowercase normalization
  - wildcard allow/deny behavior
  - invalid labels and invalid host format rejection
- Verify governance checks:
  - active paid entitlement required
  - max technical domain limit enforced
  - mutation rate limit enforced
- Verify Vercel error mapping:
  - conflict -> `ERR_DOMAIN_CONFLICT`
  - 4xx/5xx/429/timeout mapping
- Verify provider-first DNS checks extraction:
  - accepts `domain` or `host` as record host field
  - supports payloads with `checks` and provider `verification` arrays
  - no synthetic TXT/CNAME is injected when provider checks are empty

## Integration

- `add -> status -> verify -> active` with mocked Vercel payloads
- provider instructions fidelity:
  - A/AAAA/CNAME/TXT records are persisted and returned unchanged
  - provider `recommendedCNAME`/`recommendedIPv4` are persisted into `verification_targets.checks`
  - empty provider checks keep `verification_targets.checks` empty
- status derivation precedence:
  - `config.conflicts` non-empty => `conflict`
  - `verified=true` and `config.misconfigured=false` => `active`
  - `config.misconfigured=true` or `config.configuredBy=null` => `pending_dns`
  - non-verified with provider challenges/checks => `verifying`
- idempotent replay for `add` and `remove` with `Idempotency-Key`
- concurrent add race on same domain:
  - duplicate insert conflict (`23505`) returns `reused` for same tenant
  - conflict for different tenant remains `ERR_DOMAIN_CONFLICT`
- conflict/takeover path:
  - add domain already bound elsewhere -> `conflict`
  - verify keeps `conflict` until ownership resolved
- DLQ population on retry exhaustion
- DLQ retry updates `verification_targets` from latest provider payload

## E2E

- DNS propagation delay scenario:
  - add domain starts `verifying`
  - periodic reconcile eventually marks `active`
- Domain already in use:
  - request returns conflict and instructions
- Rollback/remove:
  - delete from Vercel + soft-delete row
- Tenant isolation:
  - user from tenant B cannot list/status/verify/remove tenant A domains
