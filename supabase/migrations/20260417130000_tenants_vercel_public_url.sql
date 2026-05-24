-- Add canonical Vercel project URL (public production alias) as a dedicated column.
-- tenants.vercel_url remains the per-deployment immutable URL with hash.
-- tenants.vercel_public_url is the stable public URL that always points to the latest
-- production deployment, typically https://<projectName>.vercel.app.

alter table public.tenants
  add column if not exists vercel_public_url text;

comment on column public.tenants.vercel_public_url is
  'Canonical Vercel project URL (stable alias). Example: https://santamamma.vercel.app. Use tenants.vercel_url for the per-deployment URL with hash.';

-- Backfill existing tenants. The Vercel project name is stored in final_project_name
-- when provisioned via provision-stream (post naming resolution). For older tenants
-- that predate final_project_name we fall back to slug, which matches the Vercel
-- project name in the simple legacy path (tenants/create).
update public.tenants
   set vercel_public_url = 'https://' || coalesce(nullif(trim(final_project_name), ''), nullif(trim(slug), '')) || '.vercel.app'
 where vercel_public_url is null
   and coalesce(nullif(trim(final_project_name), ''), nullif(trim(slug), '')) is not null;
