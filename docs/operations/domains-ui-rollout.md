# Domains UI Rollout

## Feature Flags

- `DOMAINS_ADMIN_UI_ENABLED=1`
  - Enables admin internal APIs and admin UI workflows.
- `NEXT_PUBLIC_DOMAINS_ADMIN_UI_ENABLED=1`
  - Enables admin pages rendering on client.

## Admin Access Control

- `INTERNAL_ADMIN_USER_IDS=<comma-separated-supabase-user-ids>`
- `INTERNAL_ADMIN_EMAILS=<comma-separated-emails>`

At least one allowlist should be configured in production.

## Staged Rollout

1. Enable backend APIs in staging.
2. Enable tenant domains tab for internal users and verify lifecycle.
3. Enable admin UI flag and validate DLQ/reconcile operations.
4. Roll out to production with monitoring on:
   - `domain_add_error`
   - `domain_verify_error`
   - `domain_remove_error`
   - DLQ backlog and stuck verifying counters.

## Rollback

- Disable `DOMAINS_ADMIN_UI_ENABLED` and `NEXT_PUBLIC_DOMAINS_ADMIN_UI_ENABLED`.
- Tenant APIs remain available, admin surfaces are hidden and protected.
