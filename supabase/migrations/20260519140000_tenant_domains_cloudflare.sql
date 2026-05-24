alter table public.tenant_domains
  add column if not exists cf_zone_id text,
  add column if not exists cf_nameservers jsonb,
  add column if not exists cf_status text,
  add column if not exists cf_zone_status_checked_at timestamptz,
  add column if not exists cf_attached_at timestamptz,
  add column if not exists cf_last_error_code text,
  add column if not exists cf_last_error_message text;

alter table public.tenant_domains
  drop constraint if exists tenant_domains_cf_status_check;

alter table public.tenant_domains
  add constraint tenant_domains_cf_status_check
  check (cf_status is null or cf_status in ('pending_ns', 'active', 'error', 'disconnected'));

create index if not exists tenant_domains_cf_status_idx
  on public.tenant_domains (cf_status)
  where cf_status is not null and deleted_at is null;
