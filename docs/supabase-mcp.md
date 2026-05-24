# Supabase MCP in Cursor (lettura DB senza dump)

Questa guida implementa l'uso di **Model Context Protocol (MCP)** con **Supabase** in modo che l'agente possa interrogare schema e dati **su richiesta** (es. `list_tables`, `execute_sql` in sola lettura), senza esportare dump nel repository.

**Documentazione ufficiale Supabase:** [Model context protocol (MCP)](https://supabase.com/docs/guides/getting-started/mcp)  
**Documentazione Cursor:** [Model Context Protocol](https://cursor.com/docs/context/mcp)

---

## 1. Sicurezza (da leggere prima di collegare dati reali)

Collegare un database a un LLM comporta rischi. Supabase li descrive nella sezione [Security risks](https://supabase.com/docs/guides/getting-started/mcp#security-risks).

### Prompt injection

Contenuto non attendibile (es. testo utente in un ticket) potrebbe indurre il modello a eseguire query indesiderate. **Mitigazioni:**

- In Cursor, **approvare manualmente** ogni chiamata ai tool MCP e controllare SQL/argomenti prima di eseguire.
- Limitare i **feature groups** esposti dal server MCP (vedi configurazione sotto).

### Raccomandazioni Supabase (riepilogo)

| Misura | Note |
|--------|------|
| **`features=`** | Abilita solo i gruppi necessari (es. `database,docs`) per ridurre la superficie d'attacco. |
| **Branching** | Usare un branch di sviluppo quando possibile. |
| **`project_ref=`** | Limita l'accesso a un singolo progetto. |
| **`read_only=true`** | Le query SQL usano un utente Postgres in sola lettura. |
| **Non produzione** | Preferire progetti dev e dati non sensibili / offuscati. |
| **Solo interno** | MCP con i permessi del developer: non per clienti o utenti finali. |

> Supabase indica che MCP e pensato per **sviluppo e test**, non per esporre dati di produzione all'AI.

---

## 2. Configurazione in Cursor

### Opzione A -- File di progetto (consigliata per questo repo)

1. Copia il template:

   ```bash
   cp .cursor/mcp.json.example .cursor/mcp.json
   ```

2. Apri `.cursor/mcp.json` e sostituisci `YOUR_PROJECT_REF` con il **Project ID** del progetto Supabase (Dashboard > Project Settings > General; compare anche nell'URL del progetto).

3. URL risultante (esempio):

   `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true&features=database,docs`

   Parametri usati nel template:

   - **`read_only=true`** -- SQL in sola lettura.
   - **`features=database,docs`** -- solo strumenti database e ricerca documentazione Supabase (niente account management, edge functions, ecc., salvo che tu li aggiunga).

4. Riavvia Cursor (o ricarica la finestra) cosi legge la nuova configurazione.

5. Completa l'**autenticazione OAuth** con Supabase quando Cursor la richiede (finestra browser, organizzazione corretta).

> Il file `.cursor/mcp.json` e in **`.gitignore`**: resta locale al tuo clone; il team condivide solo `.cursor/mcp.json.example`.

### Opzione B -- Dashboard Supabase

Puoi generare la configurazione dal [pannello MCP nella documentazione Supabase](https://supabase.com/docs/guides/getting-started/mcp) (client Cursor, progetto, opzioni) e incollare il risultato in Cursor **Settings > Cursor Settings > Tools & MCP** oppure in `~/.cursor/mcp.json` per uso globale.

### CI / token (solo se necessario)

Per ambienti senza browser, Supabase documenta **Personal Access Token** nell'header `Authorization`. Vedi [Manual authentication](https://supabase.com/docs/guides/getting-started/mcp#manual-authentication). Non committare token.

### Sviluppo locale (Supabase CLI)

Con `supabase start`, MCP locale: `http://localhost:54321/mcp` (vedi doc Supabase).

---

## 3. Verifica che funzioni

1. **Cursor:** **Settings > Cursor Settings > Tools & MCP** -- il server **supabase** deve risultare connesso (eventualmente dopo OAuth e riavvio).

2. **Tool disponibili:** nella chat, in "Available tools" / elenco MCP, dovresti vedere strumenti legati a **database** (es. `list_tables`, `execute_sql`, a seconda della versione del server).

3. **Prova in chat (esempi):**
   - *"Elenca le tabelle del database usando gli strumenti MCP Supabase."*
   - *"Esegui una SELECT di prova su una tabella sicura (read-only), usando MCP."*

4. Se qualcosa fallisce: **Output** > menu a tendina **MCP Logs** (come da [FAQ Cursor MCP](https://cursor.com/docs/context/mcp)).

---

## Riferimenti

- [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) (repository server MCP)
