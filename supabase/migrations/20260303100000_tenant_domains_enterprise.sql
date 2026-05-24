create table if not exists public.tenant_domains (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain text not null,
  status text not null default 'pending_dns',
  verification_method text not null default 'dns',
  verification_token text,
  verification_targets jsonb not null default '{}'::jsonb,
  last_vercel_payload jsonb not null default '{}'::jsonb,
  last_error_code text,
  last_error_message text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  verified_at timestamptz,
  deleted_at timestamptz,
  constraint tenant_domains_status_check check (
    status in ('pending_dns', 'verifying', 'verified', 'active', 'conflict', 'error', 'deleted')
  )
);

create unique index if not exists tenant_domains_domain_unique_active_idx
  on public.tenant_domains (lower(domain))
  where deleted_at is null;

create index if not exists tenant_domains_tenant_status_idx
  on public.tenant_domains (tenant_id, status)
  where deleted_at is null;

create table if not exists public.tenant_domain_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_domain_id uuid references public.tenant_domains(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  event_status text not null default 'pending',
  correlation_id text,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint tenant_domain_events_status_check check (event_status in ('success', 'error', 'pending'))
);

create unique index if not exists tenant_domain_events_idempotency_unique_idx
  on public.tenant_domain_events (tenant_id, actor_user_id, event_name, idempotency_key)
  where idempotency_key is not null;

create index if not exists tenant_domain_events_tenant_created_idx
  on public.tenant_domain_events (tenant_id, created_at desc);

create table if not exists public.tenant_domain_dlq (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_domain_id uuid references public.tenant_domains(id) on delete set null,
  operation text not null,
  domain text not null,
  attempts integer not null default 0,
  last_error_code text,
  last_error_message text,
  payload jsonb not null default '{}'::jsonb,
  next_retry_at timestamptz,
  last_attempt_at timestamptz not null default timezone('utc'::text, now()),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists tenant_domain_dlq_pending_idx
  on public.tenant_domain_dlq (resolved_at, next_retry_at);
