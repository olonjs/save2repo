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
  delete from public.deployments as d
  where d.tenant_id = p_tenant_id;
  get diagnostics v_deployments_deleted = row_count;

  -- Keep this state list aligned with licensing assigned states.
  update public.billing_intents as bi
  set
    tenant_id = null,
    state = 'licensed_ready_unassigned',
    updated_at = timezone('utc', now())
  where bi.tenant_id = p_tenant_id
    and bi.state in ('licensed_ready_assigned', 'licensed_ready');
  get diagnostics v_entitlements_released = row_count;

  return query
  with deleted as (
    delete from public.tenants as t
    where t.id = p_tenant_id
    returning t.id, t.name, t.slug
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
