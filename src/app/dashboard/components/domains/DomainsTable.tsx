"use client";

import { Fragment, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clipboard, ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DomainRecord, DomainStatus } from "./types";
import { DomainStatusBadge } from "./DomainStatusBadge";
import { DomainDeleteDialog } from "./DomainDeleteDialog";
import { DomainCloudflarePanel } from "./DomainCloudflarePanel";
import { DnsRecordsPanel } from "./DnsRecordsPanel";
import { checksFromTargets } from "./checks";

type StepState = "done" | "current" | "error";
type GuidedStep = {
  id: string;
  title: string;
  detail: string;
  state: StepState;
};

function isBlockingStatus(status: DomainStatus): boolean {
  return status === "pending_dns" || status === "conflict" || status === "error";
}

function buildGuidedSteps(row: DomainRecord): GuidedStep[] {
  if (row.status === "active" || row.status === "verified") {
    return [
      { id: "add", title: "Domain added", detail: "The domain is connected to your tenant.", state: "done" },
      { id: "dns", title: "DNS records set", detail: "Required records are in place.", state: "done" },
    ];
  }
  if (row.status === "error" || row.status === "conflict") {
    return [
      { id: "add", title: "Domain added", detail: "The domain is registered in JsonPages.", state: "done" },
      {
        id: "dns",
        title: "DNS configuration error",
        detail:
          row.last_error_message ??
          "Provider checks failed. Configure DNS records exactly as shown below, then refresh status.",
        state: "error",
      },
    ];
  }
  if (row.status === "verifying") {
    return [
      { id: "add", title: "Domain added", detail: "The domain is registered in JsonPages.", state: "done" },
      {
        id: "dns",
        title: "Configure DNS records",
        detail: "Copy the DNS records below in your provider, wait propagation, then refresh status.",
        state: "current",
      },
    ];
  }
  if (row.status === "pending_dns") {
    return [
      { id: "add", title: "Domain added", detail: "The domain is registered in JsonPages.", state: "done" },
      {
        id: "dns",
        title: "Configure DNS records",
        detail: "Copy the DNS records below in your provider and refresh status when propagation starts.",
        state: "current",
      },
    ];
  }
  return [
    { id: "add", title: "Domain added", detail: "Domain request registered.", state: "done" },
    { id: "dns", title: "Configure DNS records", detail: "Set provider DNS records and refresh status.", state: "current" },
  ];
}

export function DomainsTable({
  rows,
  pendingByDomain,
  onRefreshStatus,
  onRemove,
  onCfBootstrap,
  onCfDisconnect,
  tenantId,
}: {
  rows: DomainRecord[];
  pendingByDomain: Record<string, boolean>;
  onRefreshStatus: (domain: string) => Promise<void>;
  onRemove: (domain: string) => Promise<void>;
  onCfBootstrap: (domain: string) => Promise<void>;
  onCfDisconnect: (domain: string) => Promise<void>;
  tenantId: string;
}) {
  const [manualExpandedByDomain, setManualExpandedByDomain] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const expandedByDomain = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of rows) {
      const manual = manualExpandedByDomain[row.domain];
      map[row.domain] = typeof manual === "boolean" ? manual : isBlockingStatus(row.status);
    }
    return map;
  }, [manualExpandedByDomain, rows]);

  const copyText = async (key: string, value: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No domains configured yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-elevated text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Domain</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Updated</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pending = Boolean(pendingByDomain[row.domain]);
            const expanded = expandedByDomain[row.domain];
            const steps = buildGuidedSteps(row);
            const checks = checksFromTargets(row.verification_targets);
            return (
              <Fragment key={row.id}>
                <tr key={row.id} className="border-t border-border hover:bg-elevated/60">
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono text-foreground hover:text-foreground">
                      {row.domain}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <DomainStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.updated_at ? new Date(row.updated_at).toLocaleString() : "n/a"}
                  </td>
                  <td className="px-3 py-2 min-w-[320px]">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRefreshStatus(row.domain)}
                        disabled={pending}
                        title="Refresh domain status"
                      >
                        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={14} />}
                        Status
                      </Button>
                      <DomainDeleteDialog
                        domain={row.domain}
                        onConfirm={() => onRemove(row.domain)}
                        disabled={pending}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-expanded={expanded}
                        onClick={() =>
                          setManualExpandedByDomain((prev) => ({
                            ...prev,
                            [row.domain]: !expanded,
                          }))
                        }
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
                      className={`overflow-hidden transition-all duration-[350ms] ${expanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}
                    >
                      <div className="grid gap-4 p-4 md:grid-cols-2">
                        <div className="rounded-md border border-border bg-elevated p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Setup guide</p>
                          <ol className="mt-2 space-y-2">
                            {steps.map((step) => {
                              const isCurrent = step.state === "current";
                              const isDone = step.state === "done";
                              const isError = step.state === "error";
                              return (
                                <li key={`${row.id}-${step.id}`} className="flex items-start gap-2">
                                  <span className="mt-0.5">
                                    {isDone ? (
                                      <CheckCircle2 className="size-4 text-success-indicator" />
                                    ) : (
                                      <Circle className={`size-4 ${isError ? "text-destructive-foreground" : isCurrent ? "text-warning-foreground" : "text-border-strong"}`} />
                                    )}
                                  </span>
                                  <div>
                                    <p className={`text-sm ${isCurrent || isError ? "font-medium text-foreground" : "text-muted-foreground"}`}>{step.title}</p>
                                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                                  </div>
                                </li>
                              );
                            })}
                          </ol>
                        </div>

                        <div className="space-y-2 rounded-md border border-border bg-elevated p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">DNS checks</p>
                          {checks.length > 0 ? (
                            <div className="overflow-hidden rounded-md border border-border bg-elevated/80">
                              <table className="w-full text-xs">
                                <thead className="bg-elevated text-muted-foreground">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Name</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {checks.map((check, idx) => {
                                    const checkKey = `${row.id}-${idx}`;
                                    return (
                                      <tr key={checkKey} className="border-t border-border align-top">
                                        <td className="px-2 py-1.5 text-foreground font-mono">{check.type ?? "-"}</td>
                                        <td className="px-2 py-1.5 text-foreground font-mono break-all">{check.domain ?? "-"}</td>
                                        <td className="px-2 py-1.5">
                                          <div className="flex items-start gap-2">
                                            <code className="font-mono text-foreground break-all">{check.value ?? "-"}</code>
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground hover:text-foreground"
                                              onClick={() => copyText(`check-${checkKey}-value`, check.value)}
                                            >
                                              {copiedKey === `check-${checkKey}-value` ? <ClipboardCheck className="size-3.5" /> : <Clipboard className="size-3.5" />}
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              DNS checks are loading. Required records will appear here once available.
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Configure all required records shown above, then use Refresh while DNS propagates, and Verify to finalize.
                          </p>
                        </div>
                      </div>
                      <div className="px-4 pb-4 space-y-4">
                        <DomainCloudflarePanel
                          domain={row}
                          busy={pending}
                          onConnect={() => onCfBootstrap(row.domain)}
                          onRefresh={() => onRefreshStatus(row.domain)}
                          onDisconnect={() => onCfDisconnect(row.domain)}
                        />
                        {row.cf_status === "active" && (
                          <DnsRecordsPanel tenantId={tenantId} domain={row.domain} />
                        )}
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
