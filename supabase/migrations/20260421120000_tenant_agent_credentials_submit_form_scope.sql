-- Extend tenant_agent_credentials.scopes CHECK to allow the new
-- `submit-form` scope introduced by ADR-0001 (MCP submit-form tool).
--
-- The application layer (AgentCredentialScope, ALLOWED_SCOPES, MCP gateway)
-- already enforces the scope at the auth layer; this migration closes the
-- drift on the DB CHECK constraint so inserts with `submit-form` succeed.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'tenant_agent_credentials_scopes_check'
      and conrelid = 'public.tenant_agent_credentials'::regclass
  ) then
    alter table public.tenant_agent_credentials
      drop constraint tenant_agent_credentials_scopes_check;
  end if;

  alter table public.tenant_agent_credentials
    add constraint tenant_agent_credentials_scopes_check
    check (
      array_length(scopes, 1) >= 1
      and scopes <@ array['read', 'write', 'submit-form']::text[]
    );
end $$;
