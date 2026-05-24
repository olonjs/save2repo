-- ============================================================================
-- BASELINE / RECONCILIATION — public.licenses
-- ============================================================================
-- This table was created historically in the Supabase production database
-- (SQL Editor, out of version control) and was not declared in any versioned
-- migration under supabase/migrations/. As a consequence, a fresh environment
-- rebuilt from this folder would be missing public.licenses, causing runtime
-- failures in src/app/api/v1/link/route.ts (which INSERTs into this table)
-- and anywhere licensing state is read.
--
-- This migration is a baseline: it declares the canonical shape of
-- public.licenses so every future environment (new Supabase project, local
-- dev, CI, staging) reaches the same state as production. It is idempotent
-- against the existing production DB:
--   - `create table if not exists` is a no-op when the table already exists
--     with the same shape.
--   - Column / constraint additions are guarded so re-running is safe.
--
-- Compliance with .cursor/rules/tenant-delete-cascade.mdc:
--   - `licenses.tenant_id` references public.tenants(id) ON DELETE CASCADE,
--     so licenses rows are automatically cleaned up by
--     public.delete_tenant_with_entitlement_release via the cascade chain
--     fired by DELETE FROM public.tenants.
-- ============================================================================

create table if not exists public.licenses (
  id uuid primary key default extensions.uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  license_key text not null unique,
  ls_subscription_id text,
  ls_variant_id text,
  status text default 'active'::text,
  plan_tier text default 'tier1'::text,
  storage_usage_bytes bigint default 0,
  storage_limit_bytes bigint default 1073741824
);

-- Guarded column additions — cover partial-state environments.
alter table public.licenses
  add column if not exists ls_subscription_id text,
  add column if not exists ls_variant_id text,
  add column if not exists status text default 'active'::text,
  add column if not exists plan_tier text default 'tier1'::text,
  add column if not exists storage_usage_bytes bigint default 0,
  add column if not exists storage_limit_bytes bigint default 1073741824;

-- Ensure the ON DELETE CASCADE is actually set on the tenant FK. In production
-- this is already the case (verified against pg_constraint), but on any env
-- where the constraint was historically created without the cascade action
-- we normalize it here so the delete RPC stays correct.
do $$
declare
  v_confdeltype char;
begin
  select confdeltype into v_confdeltype
  from pg_constraint
  where conname = 'licenses_tenant_id_fkey'
    and conrelid = 'public.licenses'::regclass;

  if v_confdeltype is null then
    alter table public.licenses
      add constraint licenses_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  elsif v_confdeltype <> 'c' then
    alter table public.licenses drop constraint licenses_tenant_id_fkey;
    alter table public.licenses
      add constraint licenses_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  end if;
end $$;

-- Defensive indexes for lookup patterns (implicit from UNIQUE, but declared
-- explicitly for intent and for any historical env where UNIQUE was added
-- without a named index).
create index if not exists licenses_tenant_id_idx on public.licenses(tenant_id);
create index if not exists licenses_license_key_idx on public.licenses(license_key);

comment on table public.licenses is
  'Tenant licensing state (plan tier, storage limits, LemonSqueezy subscription metadata). Baselined 2026-04-20 to reconcile production drift. One row per tenant (tenant_id is unique).';
comment on column public.licenses.tenant_id is
  'FK to public.tenants(id) with ON DELETE CASCADE — license rows are automatically removed on tenant delete.';
comment on column public.licenses.status is
  'Active / suspended / expired. Default active on insert.';
comment on column public.licenses.plan_tier is
  'Plan tier code (tier1, tier2, ...). Mirrors LemonSqueezy variant mapping.';
comment on column public.licenses.storage_limit_bytes is
  'Max storage allowed for this tenant in bytes. Default 1 GiB (1073741824).';
