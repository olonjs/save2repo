# Invio form contatti (API)

Guida pratica per usare l’API OlonJS che riceve i form contatti dal sito (o da integrazioni collegate al progetto).

## Endpoint

`POST https://app.olon.it/api/v1/forms/submit`

## Autenticazione

Ogni richiesta deve includere la **API key del progetto** (tenant):

- Header: `Authorization: Bearer <API_KEY>`
- Header: `Content-Type: application/json`

La key la trovi nel progetto OlonJS (dashboard / provisioning del sito). Il sito pubblicato la usa tramite variabile d’ambiente (`VITE_OLONJS_API_KEY`); non va esposta nel frontend come testo visibile agli utenti se evitabile.

Header opzionali:

- `Idempotency-Key`: identificatore **univoco di quell’invio** (non il nome della persona nel form). Serve a ripetere la stessa richiesta dopo un timeout senza creare un secondo lead. Usa un valore che **non** cambi se stai ritentando lo stesso submit; generane uno **nuovo** per ogni invio distinto del visitatore. Esempi: `form-contatti-20260511-8f3a2c`, oppure `form-{idForm}-{timestamp}` come fa il runtime OlonJS sul sito.
- `X-Correlation-Id`: id per seguire l’invio nei log e negli eventi del lead (anche UUID o stringa univoca; non è il nome del visitatore).

## Corpo della richiesta (JSON)

Il body è un oggetto JSON libero con i campi del form. Campi tipici:

| Campo | Obbligatorio | Uso |
| --- | --- | --- |
| `recipientEmail` | Sì | Destinatario della notifica email (indirizzo del titolare del form / del sito). |
| `email` | Sì | Email del visitatore; usata per `Reply-To` e per la conferma di ricezione. |
| Altri campi (`name`, `message`, …) | Dipende dal form | Salvati nel lead e inclusi nella notifica. |

Esempio minimo:

```json
{
  "recipientEmail": "info@esempio.it",
  "name": "Mario Rossi",
  "email": "mario@esempio.it",
  "message": "Vorrei informazioni sul soggiorno.",
  "page": "/contatti",
  "source": "olon-form"
}
```

## Uso sul sito OlonJS (senza scrivere fetch a mano)

1. Nel JSON della sezione form imposta `recipientEmail` (es. `info@masseria.it`) — obbligatorio.
2. Nel markup del form usa `data-olon-recipient` con lo stesso indirizzo e un campo `email` obbligatorio per il visitatore, più gli altri campi del form (es. `name`, `message`).
3. L’app tenant con `useOlonForms` invia in automatico a `VITE_OLONJS_CLOUD_URL` + `/forms/submit` (base tipica: `https://app.olon.it/api/v1`) con `Authorization: Bearer` + API key.

Se mancano endpoint o key in env, il form non invia e in console compare un avviso.

## Chiamata HTTP diretta (test o integrazione)

```bash
curl -sS -X POST "https://app.olon.it/api/v1/forms/submit" \
  -H "Authorization: Bearer YOUR_TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: form-contatti-20260511-8f3a2c" \
  -d '{
    "recipientEmail": "info@esempio.it",
    "name": "Test",
    "email": "test@esempio.it",
    "message": "Prova API form"
  }'
```

## Risposte

| HTTP | Significato |
| --- | --- |
| `200` | Lead accettato; invio email principale ok. |
| `202` | Lead accettato; `partialSuccess` (es. archivio Git o conferma visitatore non riusciti, ma notifica principale ok). |
| `401` | Manca `Authorization: Bearer`. |
| `403` | API key non valida. |
| `409` | Nessun destinatario email risolvibile. |
| `429` | Troppi invii dallo stesso IP in un minuto; riprova dopo breve attesa. |
| `502` | Lead salvato ma invio email fallito (`delivery_status` `error`). |

Risposta di successo (schema indicativo):

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

## Cosa controllare in dashboard

Sezione **Lead**: dati inviati, stato consegna (`received`, `sent`, `delivered`, `warning`, `error`), cronologia eventi.

Gli aggiornamenti dopo `sent` (es. `delivered`, bounce) arrivano dal webhook Resend: `docs/guides/webhook-resend-consegna-email.md`.

## Problemi comuni

1. **429** — non ripetere submit in loop; un invio ogni minuto per IP è il limite di default.
2. **409 destinatario** — manca `recipientEmail` valido nel payload.
3. **Lead senza email** — controlla API key, URL base (`https://app.olon.it/api/v1`) e che il POST sia JSON con `Authorization`.
4. **`error` su lead** — destinatario o casella; vedi anche guida webhook Resend.

## Riferimenti

- Webhook consegna: `docs/guides/webhook-resend-consegna-email.md`
- Dettaglio implementativo: `docs/flows/v1-forms-submit.md`
- English version: `docs/guides/form-contatti-invio.en.md`
