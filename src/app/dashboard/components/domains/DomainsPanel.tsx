"use client";

import { DomainAddForm } from "./DomainAddForm";
import { DomainErrorBanner } from "./DomainErrorBanner";
import { DomainsTable } from "./DomainsTable";
import { useDomains } from "./useDomains";

export function DomainsPanel({ tenantId }: { tenantId: string }) {
  const {
    domains,
    loading,
    error,
    pendingByDomain,
    pendingCount,
    addDomain,
    refreshDomain,
    removeDomain,
    cfBootstrap,
    cfDisconnect,
  } = useDomains(tenantId);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Domains</h2>
          <p className="text-sm text-muted-foreground">
            Add your domain, configure all required DNS records from provider checks, then verify ownership. Pending checks: {pendingCount}.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DomainAddForm onAdd={addDomain} disabled={loading} />
        </div>
      </div>

      <DomainErrorBanner error={error} />

      <DomainsTable
        rows={domains}
        pendingByDomain={pendingByDomain}
        onRefreshStatus={(domain) => refreshDomain(domain, false).then(() => undefined)}
        onRemove={removeDomain}
        onCfBootstrap={(domain) => cfBootstrap(domain).then(() => undefined)}
        onCfDisconnect={(domain) => cfDisconnect(domain).then(() => undefined)}
        tenantId={tenantId}
      />
    </div>
  );
}
