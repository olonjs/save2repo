# Resend webhook — form email delivery

Practical guide: connect Resend to OlonJS to update **lead delivery status** after a form submission.

## Endpoint (Resend → OlonJS only)

`POST https://app.olon.it/api/v1/webhooks/resend`

- Method: **POST only** (Resend notifies the platform).
- **Do not** call from the browser, site forms, or with the tenant API key.
- Body: JSON from Resend; **Svix** signature in headers `svix-id`, `svix-timestamp`, `svix-signature`.

## Who configures what

| Role | Action |
| --- | --- |
| Site / project owner | Set `recipientEmail` on the form and review leads in the dashboard. **Do not** configure this webhook. |
| OlonJS + Resend operator | Create the webhook in Resend, set URL and platform secret (`RESEND_WEBHOOK_SECRET`). |

## Resend setup (steps)

1. Open the Resend project OlonJS uses for form notifications.
2. Go to **Webhooks** → **Add endpoint**.
3. **Endpoint URL:** `https://app.olon.it/api/v1/webhooks/resend`
4. Enable at least these **events**:
   - `email.sent`
   - `email.delivered`
   - `email.bounced`
   - `email.complaint`
5. Save and copy the **Signing secret** into the platform secret (aligned with `RESEND_WEBHOOK_SECRET` on the `app.olon.it` instance).
6. Send a test event from Resend: delivery must return **HTTP 200**. `401` = secret or signature mismatch.

## What OlonJS does when an event arrives

1. Verifies the Svix signature.
2. Records the event (duplicates → `200` with `duplicate: true`).
3. Maps event type to lead status:

| Resend event | Lead status |
| --- | --- |
| `email.sent` | `sent` |
| `email.delivered` | `delivered` |
| `email.bounced` | `error` |
| `email.complaint` | `warning` |

4. Updates the lead matched by `resend_id` and appends a timeline entry.

## What you see in the dashboard

Lead badge: `received`, `sent`, `delivered`, `warning`, `error`. Lead detail = timeline (form submit + Resend events).

Without a configured webhook or with a wrong secret, the lead can stay on `sent` even when the message is already in the inbox.

## End-to-end flow with the form

1. Visitor submits form → `POST https://app.olon.it/api/v1/forms/submit` (guide: `docs/guides/form-contatti-invio.en.md`).
2. OlonJS creates the lead and sends email via Resend (`delivery_status` → `sent`).
3. Resend notifies `POST .../webhooks/resend`.
4. OlonJS updates status and history.

## Do not

- Call the webhook with `curl` or Postman without a valid Svix signature: `401`.
- Use the tenant API key on this endpoint.
- Expect instant `delivered` updates: they may follow `sent`.

## If status does not update

1. Lead exists in the dashboard and initial send is not `error`.
2. Wait a few minutes after `sent`.
3. In Resend: URL `https://app.olon.it/api/v1/webhooks/resend`, events enabled, test delivery 200.
4. On `error` / `warning`: check form recipient and mailbox.

## References

- Form submit: `docs/guides/form-contatti-invio.en.md`
- Implementation detail: `docs/flows/v1-webhooks-resend.md`
- Italian version: `docs/guides/webhook-resend-consegna-email.md`
