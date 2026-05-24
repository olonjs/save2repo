# Webhook Resend — consegna email form

Guida pratica: come collegare Resend a OlonJS per aggiornare lo **stato di consegna** dei lead dopo l’invio form.

## Endpoint (solo Resend → OlonJS)

`POST https://app.olon.it/api/v1/webhooks/resend`

- Metodo: **solo POST** (Resend notifica la piattaforma).
- **Non** si usa dal browser, dai form del sito o con la API key del tenant.
- Body: JSON inviato da Resend; firma **Svix** negli header `svix-id`, `svix-timestamp`, `svix-signature`.

## Chi configura cosa

| Ruolo | Azione |
| --- | --- |
| Proprietario sito / progetto | Imposta `recipientEmail` sul form e verifica i lead in dashboard. **Non** configura questo webhook. |
| Chi gestisce OlonJS + Resend | Crea il webhook in Resend, imposta URL e secret lato piattaforma (`RESEND_WEBHOOK_SECRET`). |

## Configurazione in Resend (passi)

1. Accedi al progetto Resend usato da OlonJS per le notifiche form.
2. Apri **Webhooks** → **Add endpoint**.
3. **Endpoint URL:** `https://app.olon.it/api/v1/webhooks/resend`
4. **Eventi** da abilitare almeno:
   - `email.sent`
   - `email.delivered`
   - `email.bounced`
   - `email.complaint`
5. Salva e copia il **Signing secret** nel secret di piattaforma (allineato a `RESEND_WEBHOOK_SECRET` sull’istanza `app.olon.it`).
6. Invia un evento di test da Resend: la consegna deve rispondere **HTTP 200**. `401` = secret o firma non allineati.

## Cosa fa OlonJS quando arriva un evento

1. Verifica la firma Svix.
2. Registra l’evento (duplicati → `200` con `duplicate: true`).
3. Mappa il tipo evento sullo stato lead:

| Evento Resend | Stato lead |
| --- | --- |
| `email.sent` | `sent` |
| `email.delivered` | `delivered` |
| `email.bounced` | `error` |
| `email.complaint` | `warning` |

4. Aggiorna il lead collegato tramite `resend_id` e aggiunge voce in cronologia eventi.

## Cosa vedi in dashboard

Badge sul lead: `received`, `sent`, `delivered`, `warning`, `error`. Dettaglio lead = timeline (invio form + eventi Resend).

Senza webhook configurato o con secret errato, il lead può restare su `sent` anche se la mail è già in casella.

## Flusso completo con il form

1. Visitatore invia form → `POST https://app.olon.it/api/v1/forms/submit` (guida: `docs/guides/form-contatti-invio.md`).
2. OlonJS crea il lead e invia email via Resend (`delivery_status` → `sent`).
3. Resend notifica `POST .../webhooks/resend`.
4. OlonJS aggiorna stato e cronologia.

## Cosa non fare

- Non chiamare il webhook con `curl` o Postman senza firma Svix valida: risposta `401`.
- Non usare API key tenant su questo endpoint.
- Non aspettarti aggiornamenti istantanei su `delivered`: possono arrivare dopo `sent`.

## Se lo stato non si aggiorna

1. Lead in dashboard e invio iniziale non in `error`.
2. Attendi qualche minuto dopo `sent`.
3. In Resend: URL `https://app.olon.it/api/v1/webhooks/resend`, eventi attivi, delivery 200 sul test.
4. Su `error` / `warning`: verifica destinatario form e casella.

## Riferimenti

- Invio form: `docs/guides/form-contatti-invio.md`
- Dettaglio implementativo: `docs/flows/v1-webhooks-resend.md`
- English version: `docs/guides/webhook-resend-consegna-email.en.md`
