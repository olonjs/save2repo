create table if not exists public.tenant_content_store (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null default 'production',
  content_jsonb jsonb not null,
  content_version integer not null default 1,
  checksum text null,
  size_bytes integer not null,
  updated_at timestamptz not null default now(),
  updated_by text null,
  primary key (tenant_id, environment)
);

create index if not exists tenant_content_store_tenant_environment_idx
  on public.tenant_content_store (tenant_id, environment);
