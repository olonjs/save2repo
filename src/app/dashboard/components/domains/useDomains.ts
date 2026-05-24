"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiAddDomain,
  apiCfBootstrap,
  apiCfDisconnect,
  apiListDomains,
  apiRefreshDomain,
  apiRemoveDomain,
} from "./api";
import type { DomainApiError, DomainRecord } from "./types";

function upsertDomain(list: DomainRecord[], row: DomainRecord): DomainRecord[] {
  const idx = list.findIndex((item) => item.id === row.id || item.domain === row.domain);
  if (idx === -1) return [row, ...list];
  const clone = [...list];
  clone[idx] = { ...clone[idx], ...row };
  return clone;
}

export function useDomains(tenantId: string | null) {
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DomainApiError | null>(null);
  const [pendingByDomain, setPendingByDomain] = useState<Record<string, boolean>>({});

  const setPending = useCallback((domain: string, pending: boolean) => {
    setPendingByDomain((prev) => ({ ...prev, [domain]: pending }));
  }, []);

  const refreshList = useCallback(async (options?: { syncProvider?: boolean }) => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiListDomains(tenantId);
      setDomains(rows);
      if (options?.syncProvider) {
        for (const row of rows) {
          try {
            const refreshed = await apiRefreshDomain(tenantId, row.domain, false);
            setDomains((prev) => upsertDomain(prev, refreshed));
          } catch {
            // Best effort: keep list response if provider refresh fails.
          }
        }
      }
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refreshList({ syncProvider: true });
  }, [refreshList]);

  useEffect(() => {
    if (!tenantId) return;
    const hasPending = domains.some((d) => d.status === "pending_dns" || d.status === "verifying");
    if (!hasPending) return;
    const id = window.setInterval(() => {
      void refreshList();
    }, 7000);
    return () => window.clearInterval(id);
  }, [tenantId, domains, refreshList]);

  const addDomain = useCallback(
    async (domain: string) => {
      if (!tenantId) return;
      setError(null);
      setPending(domain, true);
      try {
        const row = await apiAddDomain(tenantId, domain);
        setDomains((prev) => upsertDomain(prev, row));
        return row;
      } catch (err: any) {
        setError(err);
        throw err;
      } finally {
        setPending(domain, false);
      }
    },
    [tenantId, setPending]
  );

  const refreshDomain = useCallback(
    async (domain: string, verify = false) => {
      if (!tenantId) return;
      setError(null);
      setPending(domain, true);
      try {
        const row = await apiRefreshDomain(tenantId, domain, verify);
        setDomains((prev) => upsertDomain(prev, row));
        return row;
      } catch (err: any) {
        setError(err);
        throw err;
      } finally {
        setPending(domain, false);
      }
    },
    [tenantId, setPending]
  );

  const cfBootstrap = useCallback(
    async (domain: string) => {
      if (!tenantId) return;
      setError(null);
      setPending(domain, true);
      try {
        const res = await apiCfBootstrap(tenantId, domain);
        setDomains((prev) =>
          prev.map((row) =>
            row.domain === domain
              ? {
                  ...row,
                  cf_zone_id: res.cf_zone_id,
                  cf_nameservers: res.name_servers,
                  cf_status: res.cf_status as DomainRecord["cf_status"],
                  cf_last_error_code: null,
                  cf_last_error_message: null,
                }
              : row
          )
        );
        return res;
      } catch (err: any) {
        setError(err);
        throw err;
      } finally {
        setPending(domain, false);
      }
    },
    [tenantId, setPending]
  );

  const cfDisconnect = useCallback(
    async (domain: string) => {
      if (!tenantId) return;
      setError(null);
      setPending(domain, true);
      try {
        const res = await apiCfDisconnect(tenantId, domain);
        setDomains((prev) =>
          prev.map((row) =>
            row.domain === domain
              ? { ...row, cf_status: res.cf_status as DomainRecord["cf_status"] }
              : row
          )
        );
        return res;
      } catch (err: any) {
        setError(err);
        throw err;
      } finally {
        setPending(domain, false);
      }
    },
    [tenantId, setPending]
  );

  const removeDomain = useCallback(
    async (domain: string) => {
      if (!tenantId) return;
      setError(null);
      setPending(domain, true);
      try {
        await apiRemoveDomain(tenantId, domain);
        setDomains((prev) => prev.filter((item) => item.domain !== domain));
      } catch (err: any) {
        setError(err);
        throw err;
      } finally {
        setPending(domain, false);
      }
    },
    [tenantId, setPending]
  );

  const pendingCount = useMemo(
    () => domains.filter((d) => d.status === "pending_dns" || d.status === "verifying").length,
    [domains]
  );

  return {
    domains,
    loading,
    error,
    pendingByDomain,
    pendingCount,
    refreshList,
    addDomain,
    refreshDomain,
    removeDomain,
    cfBootstrap,
    cfDisconnect,
  };
}
