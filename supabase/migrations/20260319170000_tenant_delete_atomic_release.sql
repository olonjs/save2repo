-- ============================================================================
-- NORMATIVE CONTRACT — tenant delete cleanup
-- ============================================================================
-- This function is the canonical transactional delete for a tenant. Its body
-- performs only three explicit operations:
--   1. delete rows from public.deployments (full removal)
--   2. unassign rows from public.billing_intents (entitlement preserved,
--      tenant_id nulled, state flipped to 'licensed_ready_unassigned')
--   3. delete the public.tenants row itself
--
-- Every other tenant-scoped table is cleaned up via the CASCADE chain on its
-- FK to public.tenants(id). Therefore:
--
--   LAW 1: any new table holding tenant-scoped data MUST declare
--          `tenant_id uuid ... references public.tenants(id) on delete cascade`.
--
--   LAW 2: if a new table must survive tenant deletion (audit, legal retention,
--          detached entitlement), it MUST omit the FK or use `on delete set null`
--          AND be listed explicitly here, with a one-line justification. Known
--          exceptions today:
--            - public.tenant_delete_events     -> audit trail (no FK by design)
--            - public.billing_intents          -> entitlement retained (UPDATE above)
--
--   LAW 3: the tenant-delete test suite
--          (scripts/tenant-delete-enterprise-test.mjs) MUST assert row_count = 0
--          on every new tenant-scoped table introduced by future migrations.
--
-- Failing to follow these laws produces silent orphan rows — no runtime error,
-- no deploy failure, just data residue. Code review MUST enforce compliance.
--
-- See also: .cursor/rules/tenant-delete-cascade.mdc
-- ============================================================================

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
declare
  v_deployments_deleted integer := 0;
  v_entitlements_released integer := 0;
begin
  delete from public.deployments
  where tenant_id = p_tenant_id;
  get diagnostics v_deployments_deleted = row_count;

  -- Keep this state list aligned with licensing assigned states.
  update public.billing_intents
  set
    tenant_id = null,
    state = 'licensed_ready_unassigned',
    updated_at = timezone('utc', now())
  where tenant_id = p_tenant_id
    and state in ('licensed_ready_assigned', 'licensed_ready');
  get diagnostics v_entitlements_released = row_count;

  return query
  with deleted as (
    delete from public.tenants
    where id = p_tenant_id
    returning id, name, slug
  )
  select
    deleted.id,
    deleted.name,
    deleted.slug,
    v_deployments_deleted,
    v_entitlements_released
  from deleted;
end;
$$;
