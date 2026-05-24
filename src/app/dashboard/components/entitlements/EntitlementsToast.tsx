"use client";

import type { PendingEntitlement } from "@/app/dashboard/page";
import { Button } from "@/components/ui/button";

type EntitlementsToastProps = {
  pendingCount: number;
  fifoPending: PendingEntitlement | null;
  onResume: () => void;
};

export function EntitlementsToast({ pendingCount, fifoPending, onResume }: EntitlementsToastProps) {
  if (pendingCount <= 0) return null;

  const fifoLine =
    fifoPending &&
    `FIFO · ${fifoPending.planCode} · ${new Date(fifoPending.updatedAt).toLocaleString()} · ${fifoPending.correlationId.slice(0, 8)}…`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border border-l-[3px] border-l-primary bg-elevated px-5 py-3.5">
      <div>
        <p className="text-[13px] font-medium text-foreground">
          You have {pendingCount} entitlements ready to consume.
        </p>
        {fifoLine && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {fifoLine}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="default"
        size="sm"
        className="shrink-0 rounded-md px-4 text-[13px] font-medium"
        onClick={onResume}
      >
        Resume tenant creation →
      </Button>
    </div>
  );
}
