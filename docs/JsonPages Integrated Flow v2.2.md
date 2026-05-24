# 🦅 JsonPages Integrated Flow v2.2
**Percorso: Dall'Acquisto al Live (The 3-Minute Magic)**

---

## FASE 1: Intent & Identity (Landing + Auth)
L'utente non è ancora nel sistema, ma ha scelto un piano.

1.  **Landing (`jsonpages.io`):** L'utente clicca su "Buy Starter ($9)".
2.  **Auth Gate:** Viene reindirizzato al login GitHub (Supabase).
    *   *Parametro:* `?plan=starter`.
3.  **Identity Creation:** Supabase crea l'utente in `auth.users`.
4.  **Dashboard Landing:** L'utente atterra in Dash. Il sistema vede il parametro `plan` e mostra la card: *"Completa l'acquisto per il piano Starter"*.

---

## FASE 2: Commercial Fulfillment (Lemon Squeezy)
Trasformiamo l'intento in una licenza valida.

1.  **Checkout:** L'utente clicca "Paga" e si apre l'Overlay di Lemon Squeezy.
2.  **Payment:** L'utente completa la transazione.
3.  **Webhook LS (`order_created`):**
    *   Il Cloud riceve il segnale con l' `owner_id` (Supabase User ID).
    *   **Azione:** Crea un record "ombra" in `public.licenses` (status: `pending_setup`, `plan_tier: 'tier1'`).
4.  **UI Sync:** La Dashboard si aggiorna in tempo reale: *"Pagamento confermato! Prepariamo il tuo spazio."*

---

## FASE 3: Permission Bridge (GitHub App Check)
Qui gestiamo la frizione che abbiamo individuato: l'app deve essere installata.

1.  **App Check:** Il Cloud interroga le installazioni per quell'utente GitHub.
2.  **Scenario A (App Mancante):**
    *   Mostriamo: *"Step 1: Collega il tuo account GitHub"*.
    *   L'utente clicca e installa l'app `JsonPages Cloud Sync`.
    *   **Redirect:** GitHub lo rimanda a `/dashboard/new?installation_id=XYZ`.
3.  **Scenario B (App Presente):**
    *   Il Cloud trova già l' `installation_id`.
    *   Passa direttamente allo Step 2.

---

## FASE 4: Atomic Genesis (Il tuo Flowchart `tenants/create`)
L'utente è "armato": ha la licenza e l'app installata. Ora inserisce solo il nome.

1.  **Input Utente:** Scrive lo **Slug** (es. `mio-sito-figo`) e clicca **"Launch Site"**.
2.  **Orchestration Saga (Esecuzione Tecnica):**
    *   **Normalize & Config:** Genera `apiKey`, carica env Vercel.
    *   **GitHub Phase:** `createUsingTemplate` (o fallback copy blobs).
    *   **Vercel Phase:** Crea progetto nel Team Pro + Link Repo.
    *   **DNA Injection:** Inietta `VITE_JSONPAGES_API_KEY` e `JSONPAGES_TENANT_ID`.
    *   **DB Persistence:**
        *   `INSERT public.tenants` (status: `active`).
        *   **Link Licenza:** Aggiorna il record `licenses` creato nella Fase 2 collegandolo al `tenant_id`.

---

## FASE 5: Life & Save Loop (The Dopa-Component)
Il sito è live, l'utente inizia a editare.

1.  **Studio Edit:** L'utente cambia un testo e clicca **Save**.
2.  **Save-Stream (`/api/v1/save-stream`):**
    *   Il Cloud fa il **Commit** su GitHub.
    *   Il Cloud avvia il **Polling** su Vercel tramite il `commitSha`.
3.  **UI Feedback (Il tuo Diagramma SSE):**
    *   `[✓] Commit created`
    *   `[✓] Push done`
    *   `[⟳] Vercel Building...`
    *   `[✓] Live! 🎉`

---

### 🛠 Note Tecniche per l'implementazione:

*   **Idempotenza:** Se l'utente ricarica la pagina durante la Fase 4, il Cloud deve capire che il repo è già stato creato e saltare allo step successivo (Vercel).
*   **Relazione 1:1:** Lo schema DB garantisce che ogni licenza pagata su LS sia "consumata" da un solo tenant.
*   **Frizione Zero:** L'utente ha fatto solo 3 azioni reali: *Login, Paga, Scrivi Nome*. Tutto il resto è stato orchestrato dal Cloud.

