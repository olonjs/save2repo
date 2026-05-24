// save2repo Phase 0 stub for domain telemetry.
//
// The parent jsonpages-platform implementation pushed structured log lines
// and metric counters to internal observability (`tenant_domain_events`,
// custom log sink). save2repo runs in the buyer's Vercel project, so the
// destination of these events is not yet decided (likely Vercel logs +
// optional Supabase audit table). T-1xx will wire a concrete implementation.
//
// For now: no-op helpers preserve the call sites in
// `src/app/api/v1/tenants/[id]/domains/**` without coupling them to a
// removed dependency.

type LogLevel = "info" | "warn" | "error";

export function logDomain(
  _level: LogLevel,
  _eventName: string,
  _payload: Record<string, unknown> = {},
): void {
  // intentional no-op (T-1xx)
}

export function metricDomain(
  _name: string,
  _value = 1,
  _tags: Record<string, unknown> = {},
): void {
  // intentional no-op (T-1xx)
}
