-- Encrypt tenants.admin_private_key at rest via pgsodium transparent column encryption.
-- After this migration:
--   - Writes to admin_private_key are automatically encrypted on disk
--   - Reads must go through the auto-generated decrypted_tenants view
--     (column: decrypted_admin_private_key)
--   - Existing plaintext rows are re-written to force encryption via security label

create extension if not exists pgsodium;

-- Master key (idempotent): one key shared across all tenants for this column.
do $$
begin
  if not exists (select 1 from pgsodium.key where name = 'tenants_admin_private_key') then
    perform pgsodium.create_key(name => 'tenants_admin_private_key');
  end if;
end$$;

-- Mark the column as encrypted with the named key.
security label for pgsodium
  on column public.tenants.admin_private_key
  is 'ENCRYPT WITH KEY NAME tenants_admin_private_key';

-- Backfill: re-write existing non-null rows so they go through the cipher.
update public.tenants
   set admin_private_key = admin_private_key
 where admin_private_key is not null;
