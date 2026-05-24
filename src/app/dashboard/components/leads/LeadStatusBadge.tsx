"use client";

import type { LeadDeliveryStatus } from "./types";

const STYLE_BY_STATUS: Record<LeadDeliveryStatus, string> = {
  received: "border-border bg-elevated text-muted-foreground",
  sent: "border-info-border bg-info text-info-foreground",
  delivered: "border-success-border bg-success text-success-foreground",
  warning: "border-warning-border bg-warning text-warning-foreground",
  error: "border-destructive-border bg-destructive text-destructive-foreground",
};

export function LeadStatusBadge({ status }: { status: LeadDeliveryStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STYLE_BY_STATUS[status]}`}>
      {status}
    </span>
  );
}
