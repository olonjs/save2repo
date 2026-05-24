# Contact form submission (API)

Practical guide to the OlonJS API that receives contact forms from the site (or from integrations linked to the project).

## Endpoint

`POST https://app.olon.it/api/v1/forms/submit`

## Authentication

Every request must include the project **tenant API key**:

- Header: `Authorization: Bearer <API_KEY>`
- Header: `Content-Type: application/json`

You find the key in the OlonJS project (dashboard / site provisioning). The published site uses it via environment variable (`VITE_OLONJS_API_KEY`); avoid exposing it in the frontend when possible.

Optional headers:

- `Idempotency-Key`: a **unique id for that submission** (not the visitor’s name from the form). Use it to retry the same request after a timeout without creating a second lead. Keep the **same** value when retrying the same submit; generate a **new** one for each distinct visitor submission. Examples: `form-contacts-20260511-8f3a2c`, or `form-{formId}-{timestamp}` as the OlonJS site runtime does.
- `X-Correlation-Id`: id to trace the submission in logs and lead events (UUID or any unique string; not the visitor’s name).

## Request body (JSON)

The body is a free-form JSON object with form fields. Typical fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `recipientEmail` | Yes | Notification recipient (form / site owner address). |
| `email` | Yes | Visitor email; used for `Reply-To` and receipt confirmation. |
| Other fields (`name`, `message`, …) | Depends on the form | Stored on the lead and included in the notification. |

Minimal example:

```json
{
  "recipientEmail": "info@example.com",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "message": "I would like more information about a stay.",
  "page": "/contact",
  "source": "olon-form"
}
```

## On an OlonJS site (without hand-written fetch)

1. In the form section JSON set `recipientEmail` (e.g. `info@example.com`) — required.
2. In the form markup use `data-olon-recipient` with the same address and a required visitor `email` field, plus other form fields (e.g. `name`, `message`).
3. The tenant app with `useOlonForms` posts automatically to `VITE_OLONJS_CLOUD_URL` + `/forms/submit` (typical base: `https://app.olon.it/api/v1`) with `Authorization: Bearer` + API key.

If endpoint or env key is missing, the form does not submit and a warning appears in the console.

## Direct HTTP call (test or integration)

```bash
curl -sS -X POST "https://app.olon.it/api/v1/forms/submit" \
  -H "Authorization: Bearer YOUR_TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: form-contacts-20260511-8f3a2c" \
  -d '{
    "recipientEmail": "info@example.com",
    "name": "Test",
    "email": "test@example.com",
    "message": "Form API test"
  }'
```

## Responses

| HTTP | Meaning |
| --- | --- |
| `200` | Lead accepted; primary email send succeeded. |
| `202` | Lead accepted; `partialSuccess` (e.g. Git archive or visitor confirmation failed, but primary notification succeeded). |
| `401` | Missing `Authorization: Bearer`. |
| `403` | Invalid API key. |
| `409` | No resolvable recipient email. |
| `429` | Too many submissions from the same IP in one minute; retry after a short wait. |
| `502` | Lead saved but email send failed (`delivery_status` `error`). |

Success response (indicative shape):

```json
{
  "ok": true,
  "correlationId": "...",
  "partialSuccess": false,
  "lead": {
    "id": "...",
    "deliveryStatus": "sent",
    "resendId": "...",
    "storageMode": "..."
  }
}
```

## What to check in the dashboard

**Leads** section: submitted data, delivery status (`received`, `sent`, `delivered`, `warning`, `error`), event history.

Updates after `sent` (e.g. `delivered`, bounce) come from the Resend webhook: `docs/guides/webhook-resend-consegna-email.en.md`.

## Common issues

1. **429** — do not submit in a tight loop; default limit is one submission per IP per minute.
2. **409 recipient** — missing valid `recipientEmail` in the payload.
3. **No email on lead** — check API key, base URL (`https://app.olon.it/api/v1`), and JSON POST with `Authorization`.
4. **Lead `error`** — recipient or mailbox issue; see Resend webhook guide.

## References

- Delivery webhook: `docs/guides/webhook-resend-consegna-email.en.md`
- Implementation detail: `docs/flows/v1-forms-submit.md`
- Italian version: `docs/guides/form-contatti-invio.md`
