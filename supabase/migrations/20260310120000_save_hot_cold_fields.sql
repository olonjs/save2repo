alter table public.tenants
  add column if not exists vercel_edge_config_id text,
  add column if not exists unsynced_changes_count int4 not null default 0,
  add column if not exists last_hot_save_at timestamptz,
  add column if not exists last_cold_sync_at timestamptz,
  add column if not exists sync_status text not null default 'synced';

update public.tenants
set sync_status = case
  when coalesce(unsynced_changes_count, 0) > 0 then 'dirty'
  else 'synced'
end
where sync_status is distinct from case
  when coalesce(unsynced_changes_count, 0) > 0 then 'dirty'
  else 'synced'
end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenants_sync_status_check'
      and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_sync_status_check
      check (sync_status in ('dirty', 'synced'));
  end if;
end $$;

create index if not exists idx_tenants_sync_status on public.tenants(sync_status);
create index if not exists idx_tenants_unsynced_changes_count on public.tenants(unsynced_changes_count);
create index if not exists idx_tenants_last_hot_save_at on public.tenants(last_hot_save_at);
create index if not exists idx_tenants_last_cold_sync_at on public.tenants(last_cold_sync_at);

