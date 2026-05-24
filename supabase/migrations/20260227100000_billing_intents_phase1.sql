create table if not exists public.billing_intents (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null,
  state text not null default 'authenticated',
  installation_id bigint,
  installation_owner_login text,
  checkout_id text,
  checkout_url text,
  ls_variant_id text,
  correlation_id text,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint billing_intents_user_plan_unique unique (user_id, plan_code),
  constraint billing_intents_checkout_id_unique unique (checkout_id)
);

create index if not exists billing_intents_user_id_idx
  on public.billing_intents(user_id);

create index if not exists billing_intents_state_idx
  on public.billing_intents(state);

create table if not exists public.billing_webhook_events (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  provider text not null default 'lemonsqueezy',
  event_key text not null unique,
  event_name text,
  payload jsonb not null default '{}'::jsonb
);
