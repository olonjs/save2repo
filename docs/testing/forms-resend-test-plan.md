# Forms + Resend Test Plan

## Unit

- Validate Resend event mapping:
  - `email.sent -> sent`
  - `email.delivered -> delivered`
  - `email.bounced -> error`
  - `email.complaint -> warning`
- Validate webhook signature verification logic for valid/invalid signatures.
- Validate policy gating:
  - private repo + policy enabled -> git allowed
  - public repo -> db-only fallback
  - policy disabled -> db-only

Run:

```bash
npm run test:forms
```

## Integration

### Submit API (`POST /api/v1/forms/submit`)

- **Happy path**
  - valid API key
  - private repo
  - Resend configured
  - Expect `200`, lead persisted, `delivery_status=sent`, lead event inserted
- **Public repo fallback**
  - set tenant repo public
  - Expect `200/202`, no Git write, `storage_mode=db_only_public_repo`
- **Idempotency**
  - send same `Idempotency-Key` twice
  - second response must be replay (`idempotentReplay=true`)
- **Rate limiting**
  - exceed threshold from same source IP within 1 minute
  - expect `429 ERR_FORM_RATE_LIMITED`

### Webhook API (`POST /api/v1/webhooks/resend`)

- valid svix signature -> `200`, status progression in `leads`
- duplicate `svix-id` -> `200 { duplicate: true }`
- invalid signature -> `401`
- invalid JSON -> `400`

## E2E

- tenant form submit -> owner receives email -> webhook marks lead `delivered`
- simulate Resend outage:
  - submit persists lead
  - response returns delivery failure
  - `lead_dlq` receives retry item
- submit with repo public:
  - verify no commit in GitHub
  - verify lead persisted with audit trail
