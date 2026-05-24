# Spec: Admin keypair — at-rest encryption + provision auto-setup

## Objective
Due interventi indipendenti ma coordinati su `admin_private_key`:

1. **Sicurezza a riposo**: la colonna `tenants.admin_private_key` viene cifrata
   trasparentemente da `pgsodium` con una master key gestita da Supabase. Un
   dump del DB contiene solo ciphertext.

2. **Zero-touch provisioning**: durante la creazione di un nuovo tenant,
   la platform genera il keypair, persiste la privata cifrata, setta la
   public key come env var `ADMIN_PUBLIC_KEY` sul Vercel project del tenant
   via API. Il deploy iniziale del provision la prende.

Il bottone "Regenerate Keypair" in dashboard resta invariato: rotation
manuale; l'utente continua a copiare la public e a settare/redeployare a mano.

**Success:**
- Backup/dump Supabase contiene solo ciphertext per `admin_private_key`.
- Tenant appena provisionato ha già `ADMIN_PUBLIC_KEY` su Vercel al primo deploy, "Admin Access" risulta Configured nel dashboard senza click utente.
- Tenant esistenti continuano a funzionare; le loro chiavi private sono migrate al ciphertext senza downtime.
- `Regenerate Keypair` opera identico a oggi (zero behavior change UX).

## Tech Stack
Invariato (Next.js 16, Supabase, Vercel API v10). `pgsodium` extension Supabase (già attivo su Pro+).

## Commands
- Build: `npm run build`
- Lint: `npm run lint`
- Test (esistente, non modificato): `npm run test:tenant-delete`, `npm run test:domains`

## Project Structure
- `supabase/migrations/<ts>_admin_private_key_encrypted.sql` → crea master key pgsodium, applica security label, backfill
- `src/app/api/v1/tenants/[id]/admin-token/route.ts` → cambia `from('tenants')` a `from('decrypted_tenants')` per leggere la privata in chiaro
- `src/app/api/v1/tenants/provision-stream/route.ts` → step nuovo: dopo creazione progetto Vercel, genera keypair + UPDATE tenants + Vercel API set env `ADMIN_PUBLIC_KEY`
- `src/lib/vercelProjectEnv.ts` → nuovo helper minimale per `POST /v10/projects/{id}/env`
- `src/app/api/v1/tenants/[id]/admin-keypair/route.ts` → INVARIATO (l'INSERT plaintext viene cifrato da Postgres in trasparenza)

## Code Style
Lettura della privata (admin-token):
```ts
const { data: tenant, error } = await supabase
  .from("decrypted_tenants")
  .select("decrypted_admin_private_key, vercel_public_url, vercel_url")
  .eq("id", params.id)
  .single();
// usa tenant.decrypted_admin_private_key per buildJwt(...)
```

Set env Vercel:
```ts
await fetch(
  `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: "ADMIN_PUBLIC_KEY",
      value: publicKey,
      target: ["production", "preview"],
      type: "encrypted",
    }),
  }
);
```

Migration:
```sql
-- Master key (idempotente)
select pgsodium.create_key(name => 'tenants_admin_private_key')
  where not exists (select 1 from pgsodium.key where name = 'tenants_admin_private_key');

-- Trasparent column encryption
security label for pgsodium
  on column public.tenants.admin_private_key
  is 'ENCRYPT WITH KEY NAME tenants_admin_private_key';

-- Backfill: re-write esistenti per cifrarli
update public.tenants
   set admin_private_key = admin_private_key
 where admin_private_key is not null;
```

## Testing Strategy
- Sanity manual su Supabase SQL editor: `select admin_private_key from tenants` mostra ciphertext; `select decrypted_admin_private_key from decrypted_tenants` mostra PEM in chiaro.
- Provision E2E manuale: crea tenant via UI, verifica che il progetto Vercel ha env `ADMIN_PUBLIC_KEY` settata prima del deploy, e che il flag "Admin Access: Configured" appare subito nel dashboard.
- Admin-token: dopo migration, `Click "Admin"` continua a portare allo Studio del tenant. Smoke su 1 tenant esistente già provisionato.

## Boundaries

**Always:**
- Migration idempotente (`IF NOT EXISTS`, `where not exists` per la key).
- Helper `vercelProjectEnv` con retry/timeout coerente con `vercelDomains.ts`.
- Su provision, se set env Vercel fallisce → step marcato come "warning" ma il tenant viene comunque creato (la public viene salvata e l'utente vede istruzioni manuali nel pannello Admin Access). NON bloccare il provision per un errore env.

**Ask first:**
- Cambi di nome alla colonna (`admin_private_key`).
- Aggiunta colonna `admin_public_key` (per oggi non serve: la public la deriviamo dalla priv quando serve, e durante il provision è in memoria e va dritta su Vercel API).

**Never:**
- Loggare la private key in chiaro (anche durante backfill o errori).
- Aggiungere `Regenerate` automatico nel provision se il tenant ha già `admin_private_key` (sempre check + skip; la rotation resta manuale).
- Persistere la public key in Vercel env in modo destructivo se già presente (`POST /env` con stesso key dà 409 → trattare come success-equivalent o usare PATCH/upsert).

## Success Criteria
- [ ] `select admin_private_key from public.tenants limit 1` → restituisce blob ciphertext (non PEM).
- [ ] `select decrypted_admin_private_key from public.decrypted_tenants limit 1` → restituisce PEM `-----BEGIN PRIVATE KEY-----...`.
- [ ] `admin-token` endpoint risponde 200 sui tenant migrati senza modifiche client-side.
- [ ] Provision di un nuovo tenant: progetto Vercel ha env `ADMIN_PUBLIC_KEY` settata prima del primo deploy production; `tenants.admin_private_key` valorizzato (ciphertext); dashboard mostra Admin Access = Configured senza click.
- [ ] Tenant pre-esistenti senza `admin_private_key` (null): provision-only auto-setup non si applica retroattivamente; resta il bottone "Generate Keypair" manuale.
- [ ] `Regenerate Keypair` UI: comportamento identico ad oggi (mostra public, utente fa env+redeploy a mano).

## Open Questions
- **pgsodium su Free tier**: confermato sul vostro plan Supabase? (Pro+ sì di default; Free potrebbe richiedere abilitazione esplicita.)
- **Provision env set fallisce**: oltre al warning, vogliamo un retry esplicito al primo "Admin Access" click in dashboard? (Proposta: no in MVP; messaggio chiaro + bottone "Re-push to Vercel" se serve, da aggiungere solo se osserviamo il caso in prod.)
