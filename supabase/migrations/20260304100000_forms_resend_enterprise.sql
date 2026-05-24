alter table public.tenants
  add column if not exists forms_git_storage_enabled boolean not null default true,
  add column if not exists forms_storage_policy text not null default 'git_plus_db';

create table if not exists public.leads (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  source_ip inet,
  user_agent text,
  resend_id text,
  delivery_status text not null default 'received',
  storage_mode text not null default 'git_plus_db',
  github_path text,
  github_commit_sha text,
  correlation_id text,
  idempotency_key text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint leads_delivery_status_check check (
    delivery_status in ('received', 'sent', 'delivered', 'warning', 'error')
  )
);

create index if not exists leads_tenant_created_idx
  on public.leads (tenant_id, created_at desc);

create unique index if not exists leads_resend_id_unique_idx
  on public.leads (resend_id)
  where resend_id is not null;

create unique index if not exists leads_tenant_idempotency_unique_idx
  on public.leads (tenant_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.lead_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  lead_id uuid references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_name text not null,
  event_status text not null default 'pending',
  correlation_id text,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint lead_events_status_check check (event_status in ('success', 'error', 'pending', 'warning'))
);

create index if not exists lead_events_tenant_created_idx
  on public.lead_events (tenant_id, created_at desc);

create table if not exists public.lead_webhook_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  webhook_event_key text not null,
  resend_id text,
  event_type text not null,
  delivery_status text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc'::text, now()),
  processed_at timestamptz,
  constraint lead_webhook_events_delivery_status_check check (
    delivery_status is null or delivery_status in ('sent', 'delivered', 'warning', 'error')
  )
);

create unique index if not exists lead_webhook_events_event_key_unique_idx
  on public.lead_webhook_events (webhook_event_key);

create table if not exists public.lead_dlq (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  operation text not null,
  attempts integer not null default 0,
  last_error_code text,
  last_error_message text,
  payload jsonb not null default '{}'::jsonb,
  next_retry_at timestamptz,
  last_attempt_at timestamptz not null default timezone('utc'::text, now()),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists lead_dlq_pending_idx
  on public.lead_dlq (resolved_at, next_retry_at);
