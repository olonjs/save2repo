"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "./LeadStatusBadge";
import type { LeadEventRecord, LeadRecord } from "./types";

function displayValue(data: Record<string, unknown> | null | undefined, key: string): string {
  const raw = data?.[key];
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return "-";
}

// Keys injected/controlled by platform that MUST NOT be rendered as user data.
// Everything else in `leads.data` is schema-driven and rendered as-is, in the
// insertion order preserved by Postgres JSONB (which matches the tenant's
// submissionSchema declaration order).
const PLATFORM_ONLY_LEAD_KEYS = new Set(["_meta", "recipientEmail"]);

// `name` and `email` are already shown in the table row header — skip them in
// the detail block to avoid duplication.
const LEAD_DETAIL_SKIP_KEYS = new Set(["name", "email"]);

function renderLeadFieldValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "-";
  }
}

function collectLeadDetailEntries(
  data: Record<string, unknown> | null | undefined
): Array<{ key: string; value: unknown }> {
  if (!data || typeof data !== "object") return [];
  return Object.entries(data)
    .filter(([key]) => !PLATFORM_ONLY_LEAD_KEYS.has(key) && !LEAD_DETAIL_SKIP_KEYS.has(key))
    .map(([key, value]) => ({ key, value }));
}

function compactPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return "-";
  const entries = Object.entries(payload).slice(0, 4);
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" | ");
}

export function LeadsTable({
  rows,
  eventsByLeadId,
  eventsLoadingByLeadId,
  onRefresh,
  onLoadEvents,
}: {
  rows: LeadRecord[];
  eventsByLeadId: Record<string, LeadEventRecord[]>;
  eventsLoadingByLeadId: Record<string, boolean>;
  onRefresh: () => Promise<void>;
  onLoadEvents: (leadId: string) => Promise<void>;
}) {
  const [expandedByLeadId, setExpandedByLeadId] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  const expandedResolved = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of rows) {
      map[row.id] =
        expandedByLeadId[row.id] ?? (row.delivery_status === "error" || row.delivery_status === "warning");
    }
    return map;
  }, [expandedByLeadId, rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No leads yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-end border-b border-border bg-elevated/30 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
            } finally {
              setRefreshing(false);
            }
          }}
        >
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-elevated text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Contact</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Created</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const data = (row.data ?? {}) as Record<string, unknown>;
            const expanded = expandedResolved[row.id];
            const events = eventsByLeadId[row.id] ?? [];
            const loadingEvents = Boolean(eventsLoadingByLeadId[row.id]);
            const name = displayValue(data, "name");
            const email = displayValue(data, "email");
            return (
              <Fragment key={row.id}>
                <tr className="border-t border-border hover:bg-elevated/60">
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-foreground">{name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{email}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <LeadStatusBadge status={row.delivery_status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : "n/a"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-expanded={expanded}
                        onClick={async () => {
                          const next = !expanded;
                          setExpandedByLeadId((prev) => ({ ...prev, [row.id]: next }));
                          if (next && !eventsByLeadId[row.id]) {
                            await onLoadEvents(row.id);
                          }
                        }}
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Details
                      </Button>
                    </div>
                  </td>
                </tr>
                <tr className="border-t border-border bg-elevated/30">
                  <td colSpan={4} className="p-0">
                    <div
                      className={`overflow-hidden transition-all duration-[300ms] ${expanded ? "max-h-[900px] opacity-100" : "max-h-0 opacity-0"}`}
                    >
                      <div className="grid gap-4 p-4 md:grid-cols-2">
                        <div className="rounded-md border border-border bg-elevated p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Lead details</p>
                          <div className="mt-2 space-y-1 text-xs text-foreground">
                            {(() => {
                              const entries = collectLeadDetailEntries(data);
                              if (entries.length === 0) {
                                return (
                                  <p className="text-muted-foreground">No additional fields.</p>
                                );
                              }
                              return entries.map(({ key, value }) => (
                                <p key={key}>
                                  <span className="text-muted-foreground">{key}:</span>{" "}
                                  <span className="whitespace-pre-wrap break-words">
                                    {renderLeadFieldValue(value)}
                                  </span>
                                </p>
                              ));
                            })()}
                          </div>
                          <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Delivery</p>
                          <div className="mt-2 space-y-1 text-xs text-foreground">
                            <p><span className="text-muted-foreground">Storage mode:</span> {row.storage_mode ?? "-"}</p>
                            <p><span className="text-muted-foreground">Resend ID:</span> <span className="font-mono">{row.resend_id ?? "-"}</span></p>
                            <p><span className="text-muted-foreground">Correlation:</span> <span className="font-mono">{row.correlation_id ?? "-"}</span></p>
                            {row.last_error_message ? (
                              <p className="text-destructive-foreground">
                                <span className="text-muted-foreground">Last error:</span> {row.last_error_message}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-elevated p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Event timeline</p>
                          {loadingEvents ? (
                            <p className="mt-2 text-xs text-muted-foreground">Loading events...</p>
                          ) : events.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">No events available for this lead.</p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {events.map((evt) => (
                                <li key={evt.id} className="rounded-md border border-border bg-elevated/80 p-2">
                                  <p className="text-xs text-foreground">{evt.event_name}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {evt.created_at ? new Date(evt.created_at).toLocaleString() : "n/a"} - {evt.event_status}
                                  </p>
                                  <p className="mt-1 text-[11px] text-muted-foreground">{compactPayload(evt.payload)}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
