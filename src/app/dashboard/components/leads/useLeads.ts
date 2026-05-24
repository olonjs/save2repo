"use client";

import { useCallback, useEffect, useState } from "react";
import { apiListLeadEvents, apiListLeads } from "./api";
import type { LeadApiError, LeadEventRecord, LeadRecord } from "./types";

export function useLeads(tenantId: string | null) {
  const [rows, setRows] = useState<LeadRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LeadApiError | null>(null);
  const [eventsByLeadId, setEventsByLeadId] = useState<Record<string, LeadEventRecord[]>>({});
  const [eventsLoadingByLeadId, setEventsLoadingByLeadId] = useState<Record<string, boolean>>({});

  const refreshList = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiListLeads(tenantId);
      setRows(result.rows);
      setTotalCount(result.count);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadEvents = useCallback(
    async (leadId: string) => {
      if (!tenantId) return;
      setEventsLoadingByLeadId((prev) => ({ ...prev, [leadId]: true }));
      try {
        const events = await apiListLeadEvents(tenantId, leadId);
        setEventsByLeadId((prev) => ({ ...prev, [leadId]: events }));
      } catch (err: any) {
        setError(err);
      } finally {
        setEventsLoadingByLeadId((prev) => ({ ...prev, [leadId]: false }));
      }
    },
    [tenantId]
  );

  return {
    rows,
    totalCount,
    loading,
    error,
    eventsByLeadId,
    eventsLoadingByLeadId,
    refreshList,
    loadEvents,
  };
}
