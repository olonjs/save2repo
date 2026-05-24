alter table if exists public.billing_intents
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

with matches as (
  select
    bi.id as intent_id,
    t.id as tenant_id,
    count(*) over (partition by bi.id) as match_count
  from public.billing_intents bi
  join public.tenants t
    on t.owner_id = bi.user_id
   and t.github_installation_id ~ '^[0-9]+$'
   and t.github_installation_id::bigint = bi.installation_id
  where bi.tenant_id is null
    and bi.installation_id is not null
),
unique_match as (
  select intent_id, tenant_id
  from matches
  where match_count = 1
)
update public.billing_intents bi
set tenant_id = um.tenant_id
from unique_match um
where bi.id = um.intent_id;

alter table if exists public.billing_intents
  drop constraint if exists billing_intents_user_plan_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_intents_tenant_plan_unique'
  ) then
    alter table public.billing_intents
      add constraint billing_intents_tenant_plan_unique unique (tenant_id, plan_code);
  end if;
end
$$;

create index if not exists billing_intents_tenant_id_idx
  on public.billing_intents(tenant_id);
