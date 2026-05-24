### 📐 Specifica Tecnica: Fase 3 (The Permission Bridge)

**Obiettivo:** Ottenere l' `installation_id` necessario per il flowchart `tenants/create` senza che l'utente debba capire cos'è un'installazione.

#### 3.1 La "Discovery" (Stato Iniziale)
Quando l'utente atterra sulla Dashboard dopo il pagamento LS:
*   **Azione Cloud:** Il frontend chiama `GET /api/v1/github/installations`.
*   **Logica Backend:** L'API usa il JWT dell'utente per interrogare GitHub: *"Quali installazioni di 'JsonPages Cloud Sync' appartengono a questo utente?"*.
*   **Risultato:** 
    *   Se `count > 0`: Il Cloud seleziona la prima (o l'ultima) e passa alla **Fase 4 (Input Slug)**.
    *   Se `count === 0`: Il Cloud attiva lo stato di **"Friction Handling"**.

#### 3.2 Il "Friction Handling" (UI/UX)
L'utente vede una card d'azione:
*   **Messaggio:** "Collega il tuo spazio GitHub per attivare la licenza."
*   **Azione:** Un tasto che punta a `GITHUB_APP_INSTALL_URL`.
*   **Il Dettaglio Tecnico:** L'URL deve essere dinamico. GitHub permette di passare un parametro `state` (o usiamo il `Setup URL` configurato nell'App).

#### 3.3 Il "Setup URL" Loop (Il cuore del Bridge)
Nelle impostazioni della tua GitHub App, il campo **Setup URL** deve puntare a:
`https://app.jsonpages.io/dashboard/new`

**Cosa succede:**
1.  L'utente clicca "Installa" su GitHub.
2.  Sceglie il suo account e clicca "Install & Authorize".
3.  GitHub lo reindirizza automaticamente al tuo **Setup URL**.
4.  **IMPORTANTE:** GitHub appende all'URL il parametro `?installation_id=XXXX`.
5.  Il tuo frontend (Dashboard) legge l'ID dall'URL e lo valida istantaneamente.

#### 3.4 La Validazione del "Bridge"
Prima di mostrare il form del nome sito, il Cloud deve confermare che l'ID ricevuto sia "sano":
*   **Check:** Il backend verifica che l' `installation_id` sia effettivamente collegato all'utente loggato.
*   **Esito Positivo:** Lo stato della UI cambia in **"Ready to Launch"**.

---

### 🔗 L'Aggancio Finale: Licenza + Tenant

Qui arriviamo al punto di cui discutevamo prima: **quando nasce la licenza?**

Secondo questa specifica, la licenza (che LS ha creato in stato `pending_setup`) viene "bloccata" sul tenant solo nell'ultimo millisecondo del tuo flowchart `tenants/create`.

**Perché questa specifica è superiore:**
1.  **Resilienza:** Se l'utente chiude il browser dopo aver installato l'app ma prima di aver dato il nome al sito, la licenza rimane `pending_setup`. Quando torna, il sistema vede l'app già installata e lo riporta direttamente all'input del nome.
2.  **Tracciabilità:** Sappiamo esattamente in quale step l'utente abbandona (se ha pagato ma non ha installato l'app, o se ha installato l'app ma non ha creato il sito).

---

### 📝 Sintesi per il tuo Sviluppo

Per implementare questo "Bridge", ti servono solo due cose nel Cloud:

1.  **Logica di Controllo:** Una funzione che controlla se l'utente ha installazioni attive.
2.  **Capture dell'URL:** Il tuo componente Dashboard deve essere istruito a "pescare" l' `installation_id` dalla query string se presente.

