

### 📐 Specifica Tecnica: Fase 1 (Intent & Identity)

#### 1.1 L'Innesco (Landing Page)
L'utente clicca su "Buy Starter ($9)".
*   **Azione:** Il frontend lancia `supabase.auth.signInWithOAuth({ provider: 'github' })`.
*   **Il Trucco del Context:** Dobbiamo passare il piano scelto. Usiamo il parametro `redirectTo`:
    `redirectTo: https://app.jsonpages.io/auth/callback?next=/dashboard&plan=starter`

#### 1.2 L'Handshake (GitHub -> Supabase)
Supabase gestisce lo scambio OAuth. 
*   **Creazione Utente:** Supabase crea automaticamente il record in `auth.users`.
*   **Metadata:** Supabase estrae da GitHub e salva nel campo `raw_user_meta_data`:
    *   `user_name` (Il login di GitHub, es: `g-serio`) -> **FONDAMENTALE.**
    *   `full_name` (Il nome visualizzato)
    *   `avatar_url`

#### 1.3 Il "Buco" del Nome e Profilo (Database Trigger)
Per rendere i dati puliti e pronti per il tuo flowchart, consiglio un **Trigger PostgreSQL** in Supabase.
*   **Azione:** Ogni volta che un nuovo utente si registra in `auth.users`, il trigger crea automaticamente una riga in una tabella `public.profiles`.
*   **Campi Tabella `profiles`:**
    *   `id` (FK su auth.users)
    *   `github_username` (Estratto dai metadata)
    *   `display_name`
    *   `avatar_url`

**Perché serve?** Perché il tuo flowchart `tenants/create` ha bisogno dell' `ownerLogin`. Averlo in una tabella `profiles` indicizzata è molto più veloce e sicuro che andarlo a pescare ogni volta nei metadati JSON di Supabase Auth.

#### 1.4 Il Ritorno (Dashboard Context)
L'utente torna sulla dashboard. Il sistema legge il parametro `plan=starter` dall'URL.
*   **Check Interno:** Il Cloud controlla se l'utente ha già una licenza attiva.
*   **Stato UI:** 
    *   Se l'utente è nuovo: Mostra il pulsante "Paga con Lemon Squeezy" per il piano Starter.
    *   Se l'utente ha già pagato (ma ha interrotto il flusso): Salta al **Permission Bridge (Fase 3)**.

---

### 🛠 Analisi del Flusso Funzionale (Identity Flow)

**Sequenza logica:**
1.  **Click Buy** -> `signInWithOAuth`.
2.  **GitHub Auth OK** -> Supabase crea l'utente.
3.  **Trigger DB** -> Crea il profilo con il `github_username`.
4.  **Redirect Dashboard** -> Il Cloud ora sa **CHI** è l'utente (`userId`) e **COME** si chiama su GitHub (`github_username`).

### Perché questo risolve i tuoi dubbi:
*   **Nome Utente:** Usiamo il login di GitHub. È unico, è quello che serve per creare i repo, ed è quello che l'utente riconosce come sua "identità sovrana".
*   **Sincronizzazione:** Usando Supabase Auth come "ponte", non dobbiamo gestire noi la sicurezza delle password. Se l'utente è loggato su GitHub, è loggato su JsonPages.
*   **Preparazione all'Orchestrazione:** Quando arriveremo alla Fase 4 (`tenants/create`), avremo già l' `ownerLogin` pronto nel database, senza doverlo chiedere all'utente.

---

### Il consiglio del Socio (Strategia)
Non chiedere all'utente di "completare il profilo". Prendi tutto da GitHub. Meno domande facciamo, più alta è la conversione. L'unica cosa che l'utente deve confermare è il **Pagamento** e l'**Installazione dell'App**.

