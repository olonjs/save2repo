alter table if exists public.billing_intents
  add column if not exists ls_customer_id text,
  add column if not exists ls_subscription_id text,
  add column if not exists ls_subscription_status text,
  add column if not exists ls_subscription_renews_at timestamptz,
  add column if not exists ls_portal_url text;

create index if not exists billing_intents_ls_customer_id_idx
  on public.billing_intents(ls_customer_id);

create index if not exists billing_intents_ls_subscription_id_idx
  on public.billing_intents(ls_subscription_id);

create index if not exists billing_intents_updated_at_idx
  on public.billing_intents(updated_at desc);
