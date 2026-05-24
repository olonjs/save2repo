create table if not exists public.tenant_agent_credentials (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text not null unique,
  label text not null,
  scopes text[] not null default array['read', 'write']::text[],
  secret_hash text not null unique,
  secret_hint text not null,
  created_by uuid null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_tenant_agent_credentials_tenant_id
  on public.tenant_agent_credentials(tenant_id);

create index if not exists idx_tenant_agent_credentials_client_id
  on public.tenant_agent_credentials(client_id);

create index if not exists idx_tenant_agent_credentials_active
  on public.tenant_agent_credentials(tenant_id, revoked_at);

create index if not exists idx_tenant_agent_credentials_last_used_at
  on public.tenant_agent_credentials(last_used_at);

alter table public.tenant_agent_credentials enable row level security;

drop policy if exists "Agent credentials are viewable by tenant owner" on public.tenant_agent_credentials;
create policy "Agent credentials are viewable by tenant owner"
  on public.tenant_agent_credentials
  for select
  using (
    exists (
      select 1
      from public.tenants t
      where t.id = tenant_agent_credentials.tenant_id
        and t.owner_id = auth.uid()
    )
  );

drop policy if exists "Agent credentials are insertable by tenant owner" on public.tenant_agent_credentials;
create policy "Agent credentials are insertable by tenant owner"
  on public.tenant_agent_credentials
  for insert
  with check (
    exists (
      select 1
      from public.tenants t
      where t.id = tenant_agent_credentials.tenant_id
        and t.owner_id = auth.uid()
    )
  );

drop policy if exists "Agent credentials are updatable by tenant owner" on public.tenant_agent_credentials;
create policy "Agent credentials are updatable by tenant owner"
  on public.tenant_agent_credentials
  for update
  using (
    exists (
      select 1
      from public.tenants t
      where t.id = tenant_agent_credentials.tenant_id
        and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenants t
      where t.id = tenant_agent_credentials.tenant_id
        and t.owner_id = auth.uid()
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_agent_credentials_scopes_check'
      and conrelid = 'public.tenant_agent_credentials'::regclass
  ) then
    alter table public.tenant_agent_credentials
      add constraint tenant_agent_credentials_scopes_check
      check (
        array_length(scopes, 1) >= 1
        and scopes <@ array['read', 'write']::text[]
      );
  end if;
end $$;
