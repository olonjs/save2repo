"use client";

export type DomainEventItem = {
  id: string;
  event_name: string;
  event_status: "success" | "error" | "pending";
  correlation_id: string | null;
  created_at: string;
  tenant_id: string;
  actor_user_id: string | null;
  payload: Record<string, unknown> | null;
  domain?: string | null;
};

export function DomainEventsTimeline({ events }: { events: DomainEventItem[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No events to show.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((item) => (
        <div key={item.id} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-foreground">{item.event_name}</p>
            <span
              className={`text-[10px] px-2 py-0.5 rounded border ${
                item.event_status === "success"
                  ? "border-success-border text-success-foreground bg-success"
                  : item.event_status === "error"
                    ? "border-destructive-border text-destructive-foreground bg-destructive"
                    : "border-warning-border text-warning-foreground bg-warning"
              }`}
            >
              {item.event_status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{new Date(item.created_at).toLocaleString()}</p>
          {item.domain && <p className="text-xs text-muted-foreground mt-1 font-mono">{item.domain}</p>}
          {item.correlation_id && (
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">correlation: {item.correlation_id}</p>
          )}
        </div>
      ))}
    </div>
  );
}
