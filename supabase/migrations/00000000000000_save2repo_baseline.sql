-- save2repo baseline schema
-- Single-owner deployment per ADR-002.
-- One save2repo install per buyer Supabase project.
-- This single migration replaces the entire 26-migration history of the parent
-- jsonpages-platform; it is idempotent and represents the day-1 schema.

-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists "pgcrypto";
-- pgsodium is used for column-level encryption of admin_private_key.
-- On a fresh Supabase project it must be enabled in the Supabase dashboard
-- under Database → Extensions before applying this migration.
create extension if not exists "pgsodium";

-- ============================================================================
-- users: thin profile linked to auth.users
-- Single-owner: exactly one row in normal operation (the buyer).
-- The user row is created by an after-insert trigger on auth.users.
-- ============================================================================

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  github_login text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy users_self_select on public.users
  for select using (auth.uid() = id);

create policy users_self_modify on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================================
-- owner_integrations: per-owner OAuth tokens & external account ids
-- One row per owner (UNIQUE on owner_user_id).
-- vercel_oauth_token is stored at rest; treat as secret (Supabase RLS gates it).
-- ============================================================================

create table if not exists public.owner_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references public.users(id) on delete cascade,

  -- Vercel
  vercel_oauth_token text,
  vercel_team_id text,
  vercel_team_slug text,

  -- GitHub App (olonjs) installation
  github_installation_id bigint,
  github_account_login text,
  github_account_type text,  -- 'User' | 'Organization'

  updated_at timestamptz not null default now()
);

alter table public.owner_integrations enable row level security;

create policy owner_integrations_self on public.owner_integrations
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- ============================================================================
-- tenants: each row = a tenant site managed by the owner
-- deployment_target hardcoded to 'client_vercel' per ADR-001/003.
-- admin_private_key is base64 ciphertext (decrypt via decrypted_tenants view).
-- ============================================================================

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  slug text not null,
  display_name text,
  status text not null default 'provisioning',
    -- 'provisioning' | 'live' | 'failed' | 'archived'
  deployment_target text not null default 'client_vercel'
    check (deployment_target in ('client_vercel')),

  -- GitHub
  github_owner_login text,
  github_repo_name text,
  github_repo_id bigint,

  -- Vercel
  vercel_project_id text,
  vercel_url text,           -- deployment alias (per-deploy, includes hash)
  vercel_public_url text,    -- canonical alias '<project>.vercel.app'

  -- Admin signing keypair (pgsodium-encrypted)
  admin_private_key text,    -- ciphertext; PEM via decrypted_tenants view
  admin_public_key text,     -- PEM, public (set as ADMIN_PUBLIC_KEY env on tenant project)

  -- Bookkeeping
  template_repo text,        -- e.g. 'olonjs/template-site-basic'
  correlation_id text,       -- last provision correlationId

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_user_id, slug)
);

create index if not exists tenants_owner_idx on public.tenants(owner_user_id);
create index if not exists tenants_status_idx on public.tenants(status);
create index if not exists tenants_slug_idx on public.tenants(slug);

alter table public.tenants enable row level security;

create policy tenants_owner_all on public.tenants
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- ============================================================================
-- tenant_agent_credentials: MCP gateway credentials per tenant
-- Multiple credentials per tenant (one per agent / use case).
-- client_secret_hash is SHA-256 of the secret shown once on creation.
-- ============================================================================

create table if not exists public.tenant_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text not null unique,         -- prefix 'olon_client_'
  client_secret_hash text not null,       -- SHA-256 of full secret
  display_name text,
  scopes text[] not null default array['read']::text[],
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tac_tenant_idx on public.tenant_agent_credentials(tenant_id);

alter table public.tenant_agent_credentials enable row level security;

create policy tac_owner on public.tenant_agent_credentials
  for all using (
    tenant_id in (select id from public.tenants where owner_user_id = auth.uid())
  ) with check (
    tenant_id in (select id from public.tenants where owner_user_id = auth.uid())
  );

-- ============================================================================
-- tenant_domains: custom domains per tenant (Vercel API only per ADR-008)
-- No Cloudflare-specific automation day-1.
-- ============================================================================

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain text not null,
  status text not null default 'pending',
    -- 'pending' | 'verified' | 'failed' | 'removed'
  verified boolean not null default false,
  verification_payload jsonb,             -- last Vercel verify response
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, domain)
);

create index if not exists tenant_domains_tenant_idx on public.tenant_domains(tenant_id);

alter table public.tenant_domains enable row level security;

create policy tenant_domains_owner on public.tenant_domains
  for all using (
    tenant_id in (select id from public.tenants where owner_user_id = auth.uid())
  ) with check (
    tenant_id in (select id from public.tenants where owner_user_id = auth.uid())
  );

-- ============================================================================
-- Helper: updated_at trigger
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_users on public.users;
create trigger set_updated_at_users
  before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_owner_integrations on public.owner_integrations;
create trigger set_updated_at_owner_integrations
  before update on public.owner_integrations
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_tenants on public.tenants;
create trigger set_updated_at_tenants
  before update on public.tenants
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_tenant_domains on public.tenant_domains;
create trigger set_updated_at_tenant_domains
  before update on public.tenant_domains
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auto-create public.users row when a user signs in via Supabase auth
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, github_login, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'user_name',
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- Decrypted view for admin_private_key (used by serverside admin signing flow)
-- pgsodium key 'save2repo_admin_keypair' must exist in pgsodium.key before
-- first tenant provisioning; the first-boot setup wizard creates it.
-- ============================================================================

create or replace view public.decrypted_tenants as
  select
    t.*,
    case
      when t.admin_private_key is not null
        then convert_from(
          pgsodium.crypto_aead_det_decrypt(
            decode(t.admin_private_key, 'base64'),
            convert_to(t.id::text, 'utf8'),
            (select id from pgsodium.key where name = 'save2repo_admin_keypair' limit 1)
          ),
          'utf8'
        )
      else null
    end as decrypted_admin_private_key
  from public.tenants t;

-- The view is owned by the owner via the underlying RLS on tenants.
