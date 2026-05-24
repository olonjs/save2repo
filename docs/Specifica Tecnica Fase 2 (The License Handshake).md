Ottimo. La **Fase 2** è il momento in cui il "Pagamento" diventa "Potere Operativo". Usiamo il **Dopa-component** non solo per intrattenere, ma per guidare l'utente verso l'azione successiva in base al suo stato.

Ecco la specifica tecnica e funzionale della **Fase 2: Commercial Fulfillment**.

---

### 📐 Specifica Tecnica: Fase 2 (The License Handshake)

#### 2.1 Il Webhook (Dietro le quinte)
Mentre l'utente vede la conferma di pagamento su Lemon Squeezy, il tuo Cloud riceve il segnale.
*   **Endpoint:** `POST /api/v1/webhooks/ls`
*   **Azione:** 
    1.  Valida la firma del Webhook.
    2.  Estrae `userId` (dal `custom_data` che abbiamo passato nella Fase 1).
    3.  Crea/Aggiorna la riga in `public.licenses`.
    4.  **Cruciale:** Invia un evento (SSE o WebSocket) al frontend per dire: *"Ehi, la licenza è arrivata!"*.

#### 2.2 Il Ritorno in Dashboard (UX Logic)
L'utente chiude l'overlay di LS e si ritrova sulla Dashboard. Il sistema interroga il DB: `SELECT count(*) FROM tenants WHERE owner_id = userId`.

---

### 🎭 Scenario A: "The Newcomer" (0 Progetti)
L'utente ha appena comprato il suo primo piano. Non vogliamo che cerchi il tasto "Nuovo Progetto". Lo portiamo noi.

**Dopa-component "Genesis Mode":**
Appare un modal o un overlay fluido con questi check:
1.  `[✓] Payment Verified` (Ricevuto dal Webhook).
2.  `[✓] License Activated: Starter Tier`.
3.  `[⟳] Preparing your launchpad...`
4.  **Auto-Action:** Dopo 2 secondi, il modal sfuma e l'utente si ritrova direttamente nel form **"Step 1: Connect GitHub"** (Fase 3).

*Perché:* Eliminiamo il "clic di riflessione". Ha pagato per un sito, gli diamo il sito.

---

### 🎭 Scenario B: "The Upseller" (>0 Progetti)
L'utente è già un cliente (es. ha già un sito e ne ha comprato un altro o ha fatto l'upgrade).

**Dopa-component "Unlock Mode":**
Un banner o un piccolo modal reattivo in alto:
1.  `[✓] Payment Verified`.
2.  `[✓] New License Slot Active`.
3.  **Messaggio:** *"You're all set! You can now click 'New Project' to deploy your next sovereign site."*
4.  **Azione:** Il tasto **"+ New Project"** nella dashboard inizia a pulsare o si illumina.

*Perché:* Qui l'utente sa già come funziona. Non vogliamo forzarlo in un wizard se magari voleva solo fare l'upgrade di quello esistente. Gli diamo la conferma del potere acquisito.

---

### 🛠 Dettagli del "Dopa-Component" in questa fase

Per rendere il tutto "Enterprise-grade", il componente deve gestire l'attesa del Webhook. 
*   **Stato di attesa:** Se l'utente torna in dash ma il Webhook di LS non è ancora arrivato (raro ma possibile), il Dopa-component mostra: `[⟳] Waiting for payment confirmation...`.
*   **Polling/SSE:** Appena il DB si aggiorna, il componente "scatta" sui check verdi.

### Perché questo flusso è vincente:
*   **Coerenza:** Usiamo lo stesso linguaggio visivo (i check, i colori, le animazioni) che l'utente vedrà durante il deploy (Fase 5).
*   **Fulfillment Reale:** L'utente sente che il sistema sta "lavorando" per lui immediatamente dopo aver strisciato la carta.
*   **Guida Intelligente:** Distinguiamo tra chi ha bisogno di essere preso per mano (nuovo utente) e chi vuole solo il via libera (utente esperto).

---

### Il consiglio del Socio (Tech-Ops)
Nella tabella `licenses`, usa un campo `status` che parta da `pending` e diventi `active` solo al Webhook di LS. Il tuo frontend deve "ascoltare" questo cambio di stato per far scattare il Dopa-component.


