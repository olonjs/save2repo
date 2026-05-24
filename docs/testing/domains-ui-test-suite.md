# Domains UI Test Suite

## Unit

- Input normalization in add-domain form (`trim/lowercase/no trailing dot`).
- Polling policy only for `pending_dns` and `verifying`.
- Error-to-UX mapping for key codes:
  - `ERR_DOMAIN_CONFLICT`
  - `ERR_DOMAIN_RATE_LIMITED`
  - `ERR_DOMAIN_LIMIT_REACHED`
  - `ERR_DOMAIN_ENTITLEMENT_REQUIRED`

Run:

- `npm run test:domains:ui`

## Integration

- Tenant tab against real API:
  - list domains
  - add domain
  - verify/recheck
  - remove domain
- Env-driven smoke:
  - `DOMAINS_UI_TEST_BASE_URL`
  - `DOMAINS_UI_TEST_TENANT_ID`
  - `DOMAINS_UI_TEST_BEARER`

Run:

- `npm run test:domains:ui`

## E2E

- Browser suite is gated for CI orchestration:
  - set `DOMAINS_UI_E2E_ENABLED=1` to enforce gate in script
  - full browser workflow can be wired in pipeline-specific Playwright project

Scenarios:

- Tenant tab lifecycle `add -> verify -> active -> remove`
- Conflict/takeover path with `ERR_DOMAIN_CONFLICT`
- Admin DLQ retry flow and reconcile trigger
