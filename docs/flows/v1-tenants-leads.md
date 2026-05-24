# Tenant Leads API

## Purpose

Provides read access to tenant form submission leads and their event timelines for the dashboard Leads management view.

---

## GET /api/v1/tenants/:id/leads

### Trigger / Caller

- Dashboard Leads tab on mount and pagination.

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(editor)`
- Query:
  - `limit` (default 50, max 200)
  - `offset` (default 0, max 10000)
  - `status` (optional filter: `received | sent | delivered | warning | error`)
- Headers: optional `x-correlation-id`

### State Machine Effects

Read-only. No state mutations.

### External Dependencies

- Supabase `leads` (paginated query with exact count)

### Response Contract

- `200`: `{ correlationId, tenantId, leads: [...], count, limit, offset }`
  - `leads[]`: `{ id, tenant_id, data, source_ip, user_agent, resend_id, delivery_status, storage_mode, correlation_id, last_error_code, last_error_message, created_at, updated_at }`
  - `count`: total matching leads (for pagination)
- `403/404`: tenant access denied / not found
- `500`: `ERR_LEADS_LIST_FAILED`

---

## GET /api/v1/tenants/:id/leads/:leadId/events

### Trigger / Caller

- Dashboard lead detail view for event timeline.

### Request Contract

- Auth: `requireRequestUser` + `assertTenantAccess(editor)`
- Query: `limit` (default 50, max 200)
- Headers: optional `x-correlation-id`

### State Machine Effects

Read-only. First validates lead exists for tenant, then queries events.

### External Dependencies

- Supabase `leads` (existence check)
- Supabase `lead_events` (event timeline query)

### Response Contract

- `200`: `{ correlationId, tenantId, leadId, events: [...] }`
  - `events[]`: `{ id, lead_id, tenant_id, event_name, event_status, correlation_id, idempotency_key, payload, created_at }`
- `404`: `ERR_LEAD_NOT_FOUND`
- `500`: `ERR_LEAD_LOOKUP_FAILED`, `ERR_LEAD_EVENTS_LIST_FAILED`

---

## Observability

- Standard auth and access control logging.
- Query errors logged server-side.

## Verification Gates

- Submit a form via `POST /api/v1/forms/submit` and verify lead appears in list.
- Trigger email delivery and verify events appear in lead timeline.
