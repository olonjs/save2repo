Il "incastro" tra la Fase 2 (Pagamento) e la Fase 3 (GitHub Bridge) è il momento in cui la **UX diventa fluida o si rompe**. 

Dobbiamo gestire il passaggio in modo che l'utente non debba mai chiedersi "E adesso?". Ecco come si incastrano tecnicamente e visivamente.

---

### 🔗 L'Incastro: Il Dopa-Component "Morphing"

Invece di chiudere un modal e aprirne un altro, il **Dopa-component della Fase 2 "evolve"** (fa morphing) nella Fase 3.

#### 1. Il Trigger di Transizione
Appena il Webhook di Lemon Squeezy conferma la licenza, il Cloud esegue un **"Pre-Flight Check"** silenzioso:
*   `GET /api/v1/github/installations` (per l'utente loggato).

#### 2. Scenario A: L'utente NON ha l'App (Frizione Attiva)
Il Dopa-component della Fase 2 non scompare, ma aggiunge un'azione nel suo ultimo step:

*   `[✓] Payment Verified`
*   `[✓] License Activated`
*   **Azione:** Il testo in basso cambia in: *"Quasi pronto! Collega il tuo account GitHub per iniziare."*
*   **Il Tasto:** Appare un tasto **"Connect GitHub"** (che punta al `GITHUB_APP_INSTALL_URL`).
*   **Il Loop di Ritorno:** L'utente clicca, installa l'app, e GitHub lo rimanda al `Setup URL` (`/dashboard/new?installation_id=...`).
*   **L'Incastro Finale:** Al ritorno, la Dashboard vede l'ID nell'URL, il Dopa-component mostra un ultimo check verde `[✓] GitHub Connected` e sblocca il form del nome sito.

#### 3. Scenario B: L'utente HA già l'App (Zero Frizione)
Se il Pre-Flight Check vede che l'utente è già "armato":

*   `[✓] Payment Verified`
*   `[✓] License Activated`
*   `[✓] GitHub Already Connected` (Questo check appare istantaneo, dando un senso di velocità).
*   **Auto-Redirect:** Il modal si chiude da solo o sfuma verso il form **"Step 2: Name your project"**.

---

### 🛠 Logica Funzionale (Il "Ponte" nel Database)

Perché questo incastro sia solido, il Cloud deve gestire uno **Stato di Sessione Temporaneo**:

1.  **Stato "Provisioning-Ready":** Quando LS paga, il record della licenza è `status: 'active'`, ma il `tenant_id` è ancora `NULL`.
2.  **Il Vincolo:** Il sistema non permette di inserire il nome del sito (Fase 4) se non ha un `installation_id` valido in memoria o nell'URL.
3.  **L'Unione:** Solo quando l'utente preme "Launch" (alla fine di tutto), il Cloud prende:
    *   `userId` (dalla sessione).
    *   `licenseKey` (dalla licenza appena attivata).
    *   `installationId` (dal bridge appena superato).
    *   `slug` (dall'input utente).
    ...e spara il tuo **Flowchart `tenants/create`**.

---

### Perchè questo incastro è perfetto:

*   **Continuità Visiva:** L'utente vede sempre lo stesso stile di interfaccia (Dopa-component).
*   **Nessun Vicolo Cieco:** Se l'utente chiude il browser dopo il pagamento ma prima di installare l'app, quando rientra in Dashboard il sistema vede `License: Active` + `App: Missing` e gli ripropone il tasto "Connect GitHub".
*   **Efficienza:** Non facciamo installare l'app a chi l'ha già fatto (es. per un secondo sito).

