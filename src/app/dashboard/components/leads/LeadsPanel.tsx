"use client";

import { LeadsTable } from "./LeadsTable";
import { LeadErrorBanner } from "./LeadErrorBanner";
import { useLeads } from "./useLeads";

export function LeadsPanel({ tenantId }: { tenantId: string }) {
  const { rows, totalCount, loading, error, eventsByLeadId, eventsLoadingByLeadId, refreshList, loadEvents } =
    useLeads(tenantId);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Leads</h2>
          <p className="text-sm text-muted-foreground">
            Inspect inbound form submissions, delivery status, and event timeline. Total leads: {totalCount}.
          </p>
        </div>
        {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : null}
      </div>

      <LeadErrorBanner error={error} />

      <LeadsTable
        rows={rows}
        eventsByLeadId={eventsByLeadId}
        eventsLoadingByLeadId={eventsLoadingByLeadId}
        onRefresh={refreshList}
        onLoadEvents={loadEvents}
      />
    </div>
  );
}
