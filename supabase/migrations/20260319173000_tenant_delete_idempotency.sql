create table if not exists public.tenant_delete_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  status text not null check (status in ('pending', 'success', 'error')),
  response_payload jsonb,
  error_code text,
  error_message text,
  http_status integer,
  correlation_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists tenant_delete_events_idem_uniq
  on public.tenant_delete_events (tenant_id, actor_user_id, idempotency_key);

create index if not exists tenant_delete_events_created_at_idx
  on public.tenant_delete_events (created_at desc);
