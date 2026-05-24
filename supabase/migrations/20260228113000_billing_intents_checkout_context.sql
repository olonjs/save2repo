alter table if exists public.billing_intents
  add column if not exists ls_store_id text,
  add column if not exists ls_env_mode text;

create index if not exists billing_intents_ls_store_id_idx
  on public.billing_intents(ls_store_id);

create index if not exists billing_intents_ls_env_mode_idx
  on public.billing_intents(ls_env_mode);
