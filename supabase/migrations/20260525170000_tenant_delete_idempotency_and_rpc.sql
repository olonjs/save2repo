-- Tenant delete idempotency + atomic RPC (2026-05-25)
-- Ports parent jsonpages-platform schema needed by /api/v1/tenants/[id] DELETE
-- so the Settings DangerZone delete button works end-to-end.
--
-- save2repo adaptations vs parent:
--   - delete_tenant_with_entitlement_release returns 0 for deployments_deleted
--     (no `deployments` table — per-tenant Vercel deploys live on the buyer's
--     Vercel team, not in our DB)
--   - returns 0 for entitlements_released (ADR-003: Vercel Marketplace native
--     billing, no LemonSqueezy `billing_intents`)
--   - tenant column is `display_name` (save2repo) not `name` (parent); RPC
--     maps display_name -> tenant_name in the return row so the API contract
--     stays identical to parent
--
-- CASCADE deletes handle the dependent tables (tenant_domains, leads,
-- lead_events, lead_dlq, tenant_agent_credentials, tenant_domain_events,
-- tenant_domain_dlq) via their FK on tenants(id).

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

alter table public.tenant_delete_events enable row level security;

create or replace function public.delete_tenant_with_entitlement_release(
  p_tenant_id uuid
)
returns table (
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  deployments_deleted integer,
  entitlements_released integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with deleted as (
    delete from public.tenants
    where id = p_tenant_id
    returning id, display_name, slug
  )
  select
    deleted.id,
    deleted.display_name,
    deleted.slug,
    0,
    0
  from deleted;
end;
$$;
