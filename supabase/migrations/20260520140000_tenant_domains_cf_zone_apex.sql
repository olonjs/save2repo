alter table public.tenant_domains
  add column if not exists cf_zone_apex text;

-- Index on cf_zone_id to support shared-zone counting during tenant delete
-- (skip deleteZone when multiple tenant_domains rows share the same cf_zone_id).
create index if not exists tenant_domains_cf_zone_id_idx
  on public.tenant_domains (cf_zone_id)
  where cf_zone_id is not null and deleted_at is null;
