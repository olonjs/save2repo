alter table public.tenant_agent_credentials
  add column if not exists client_id text;

update public.tenant_agent_credentials
set client_id = coalesce(client_id, ('olon_client_' || replace(id::text, '-', '')))
where client_id is null;

alter table public.tenant_agent_credentials
  alter column client_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_agent_credentials_client_id_key'
      and conrelid = 'public.tenant_agent_credentials'::regclass
  ) then
    alter table public.tenant_agent_credentials
      add constraint tenant_agent_credentials_client_id_key unique (client_id);
  end if;
end $$;

create index if not exists idx_tenant_agent_credentials_client_id
  on public.tenant_agent_credentials(client_id);
