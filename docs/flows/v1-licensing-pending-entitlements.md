# `GET /api/v1/licensing/pending-entitlements`

## Purpose

List paid entitlements not yet bound to a tenant (`licensed_ready_unassigned`) for buy-then-create flow.

## Trigger / Caller

- Primary caller: `src/app/dashboard/page.tsx`
- Used on dashboard init and entitlement conflict recovery

## Request Contract

- Method: `GET`
- Auth: required (`requireRequestUser`)
- Query: none
- Header: optional `x-correlation-id`
- Hard filter:
  - `state = licensed_ready_unassigned`
  - `tenant_id IS NULL`
  - `user_id = current user`

## State Machine Effects

- Read-only endpoint
- FIFO policy enforced by ordering `updated_at ASC` (oldest first)
- Returns max 20 entries

## External Dependencies

- Supabase: `billing_intents`

## Response Contract

- `200`:
  - `correlationId`
  - `entitlements[]` with `id`, `planCode`, `correlationId`, `installationId`, `updatedAt`
- `500`:
  - `ERR_PENDING_ENTITLEMENTS_READ_FAILED`

## Observability

- Minimal response includes server `correlationId`
- Operational identifiers surfaced for UI/debug:
  - entitlement `correlationId`
  - entitlement `updatedAt`

## Failure Modes & Recovery

- DB read failure -> retry endpoint; UI should keep create flow available
- Row with invalid/missing correlation is filtered out (cannot be safely consumed)

## Verification Gates

- Results are tenant-unassigned only
- Ordering is ascending by `updatedAt` (FIFO)
- At most 20 rows returned
- Every returned row has non-empty `correlationId`

