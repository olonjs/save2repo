# 📐 Specifiche Tecniche: Sovereign Form Engine (v1.1)
**Status:** Mandatory Standard  
**Versione:** 1.1.0 (Enterprise Delivery Edition)  
**Obiettivo:** Orchestrazione atomica tra Sovereign Storage (GitHub), Managed Delivery (Resend) e Tracciamento Eventi (Webhooks).

---

## 1. Governance & Privacy Policy
*   **Sovereign Storage Mandate:** Il salvataggio dei lead su Git è consentito **esclusivamente** per repository marchiati come `private: true` su GitHub.
*   **Public Repo Fallback:** Se il repository è pubblico, il Cloud deve rifiutare la scrittura su Git per prevenire l'esposizione di PII (Personally Identifiable Information). I dati verranno archiviati solo nel database cifrato del Cloud (Supabase).
*   **Atomic Isolation:** Ogni lead deve essere salvato come file JSON unico per garantire l'immutabilità e prevenire conflitti di scrittura (`race conditions`).

---

## 2. Specifica Tenant-Side (The Form Capsule)
Il componente frontend deve interagire con il Cloud in modo asincrono.

*   **Endpoint:** `POST https://api.jsonpages.io/v1/forms/submit`
*   **Headers:**
    *   `Authorization: Bearer ${VITE_JSONPAGES_API_KEY}`
    *   `Content-Type: application/json`
*   **Payload:** Oggetto JSON libero (es. `{ name, email, message, ... }`).

---

## 3. Specifica Cloud-Side: L'Orchestratore
Il Cloud agisce come un **Transaction Manager** che coordina tre sistemi.

### A. Validazione & Pre-flight
1.  **Auth:** Identifica il tenant tramite `api_key`.
2.  **Privacy Check:** Verifica lo stato del repo via GitHub API.
3.  **Rate Limiting:** Protezione anti-spam (max 5 sottomissioni/min per IP/Tenant).

### B. Sovereign Storage (GitHub)
*   **Path:** `src/data/leads/YYYY-MM-DD-HHmm-[uuid].json`
*   **Commit Message:** Deve includere `[skip ci]` o `[vercel skip ci]` per sopprimere l'auto-deploy di Vercel.
    *   *Standard:* `New lead from contact-form [skip ci]`

### C. Managed Delivery (Resend API)
*   **Configurazione Invio:**
    *   `From:` `JsonPages Notifications <notifications@jsonpages.io>` (Dominio verificato).
    *   `To:` Email dell'owner del tenant (da `auth.users`).
    *   `Reply-To:` Email fornita dall'utente nel form.
*   **Tracking:** Il Cloud deve catturare il `resend_id` restituito dall'API per il tracciamento successivo.

---

## 4. Protocollo Resend Webhook (Delivery Tracking)
Per garantire affidabilità Enterprise, il Cloud deve monitorare l'esito della consegna.

*   **Endpoint:** `POST https://api.jsonpages.io/v1/webhooks/resend`
*   **Security:** Validazione obbligatoria della firma tramite **Svix** e `RESEND_WEBHOOK_SECRET`.
*   **Mappatura Stati:**
    *   `email.sent` -> Status: `sent` (Mail uscita).
    *   `email.delivered` -> Status: `delivered` (Mail in Inbox).
    *   `email.bounced` -> Status: `error` (Mail non consegnata).
    *   `email.complaint` -> Status: `warning` (Segnata come Spam).

---

## 5. Persistence Schema (Supabase)
Tabella `public.leads` per il monitoraggio centralizzato nella Dashboard.

| Campo | Tipo | Descrizione |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key. |
| `tenant_id` | uuid | Foreign Key su `tenants.id`. |
| `data` | jsonb | Payload completo del form. |
| `resend_id` | text | ID restituito da Resend (per join con webhook). |
| `delivery_status` | text | Stato aggiornato dai webhook (`sent`, `delivered`, ecc.). |
| `created_at` | timestamp | Data di ricezione. |

---

## 6. Logica Astratta dell'Orchestratore

```typescript
async function orchestrateFormSubmit(req) {
  // 1. Identificazione e Check Privacy
  const tenant = await getTenantByApiKey(req.headers.apiKey);
  const isPrivate = await checkGitHubRepoPrivacy(tenant.githubRepo);

  // 2. Azione A: Sovereign Storage (Solo se privato)
  if (isPrivate) {
    await github.commitFile({
      path: `src/data/leads/${generateId()}.json`,
      content: req.body,
      message: "New lead [skip ci]" // Impedisce build Vercel
    });
  }

  // 3. Azione B: Managed Delivery
  const { id: resendId } = await resend.emails.send({
    from: 'notifications@jsonpages.io',
    to: tenant.ownerEmail,
    reply_to: req.body.email,
    subject: `Lead: ${tenant.name}`,
    html: renderEmailTemplate(req.body)
  });

  // 4. Azione C: Persistence (SSOT)
  await db.leads.insert({
    tenant_id: tenant.id,
    data: req.body,
    resend_id: resendId,
    delivery_status: 'sent'
  });

  return { success: true };
}
```

---

## 7. Vantaggi del Modello v1.1

1.  **Zero Infrastructure Cost:** Sfrutta GitHub per lo storage dei dati pesanti.
2.  **Zero Vercel Waste:** Il flag `[skip ci]` risparmia minuti di build preziosi per il piano Pro.
3.  **Full Accountability:** Grazie ai Webhook, il Cloud sa sempre se una notifica è stata consegnata o meno, eliminando il "non ho ricevuto la mail".
4.  **Sovereignty:** L'utente possiede i propri lead. Se esporta il repo, esporta il suo intero database clienti.

**Questa specifica è definitiva.** Una volta implementata, JsonPages non sarà solo un builder, ma una piattaforma di acquisizione lead robusta e professionale.