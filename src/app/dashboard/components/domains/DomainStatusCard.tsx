"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Clipboard, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DomainRecord } from "./types";
import { DomainStatusBadge } from "./DomainStatusBadge";
import { checksFromTargets } from "./checks";

type StepState = "done" | "current" | "upcoming";

type GuidedStep = {
  id: string;
  title: string;
  detail: string;
  state: StepState;
};

function buildGuidedSteps(status: DomainRecord["status"]): GuidedStep[] {
  if (status === "active" || status === "verified") {
    return [
      { id: "add", title: "Domain added", detail: "The domain is connected to your tenant.", state: "done" },
      { id: "dns", title: "DNS records set", detail: "Required DNS records are in place.", state: "done" },
    ];
  }

  if (status === "pending_dns") {
    return [
      { id: "add", title: "Domain added", detail: "Your domain has been registered in JsonPages.", state: "done" },
      {
        id: "dns",
        title: "Add DNS records now",
        detail: "Copy the records below and add them in your DNS provider.",
        state: "current",
      },
      { id: "wait", title: "Wait for propagation", detail: "This usually takes a few minutes, up to 24h.", state: "upcoming" },
      { id: "verify", title: "Run verification", detail: "Click Verify after DNS appears as propagated.", state: "upcoming" },
    ];
  }

  if (status === "verifying") {
    return [
      { id: "add", title: "Domain added", detail: "Your domain has been registered in JsonPages.", state: "done" },
      { id: "dns", title: "Configure DNS records", detail: "Apply DNS checks and refresh while propagation is in progress.", state: "current" },
    ];
  }

  if (status === "conflict") {
    return [
      { id: "add", title: "Domain added", detail: "Provider checks started.", state: "done" },
      {
        id: "dns",
        title: "DNS configuration error",
        detail: "Provider reported DNS mismatch. Use the DNS checks table below.",
        state: "current",
      },
    ];
  }

  if (status === "error") {
    return [
      { id: "add", title: "Domain added", detail: "A provider error interrupted the flow.", state: "done" },
      { id: "dns", title: "DNS configuration error", detail: "Ensure host and value match provider checks exactly.", state: "current" },
    ];
  }

  return [
    { id: "add", title: "Domain added", detail: "Domain request registered.", state: "done" },
    { id: "dns", title: "Configure DNS", detail: "Set required records.", state: "current" },
  ];
}

export function DomainStatusCard({ domain }: { domain: DomainRecord | null }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const checks = useMemo(() => checksFromTargets(domain?.verification_targets), [domain?.verification_targets]);
  const guidedSteps = useMemo(() => (domain ? buildGuidedSteps(domain.status) : []), [domain]);

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

  if (!domain) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Select a domain to inspect verification details.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-foreground">{domain.domain}</h4>
        <DomainStatusBadge status={domain.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Last update: {domain.updated_at ? new Date(domain.updated_at).toLocaleString() : "n/a"}
      </p>
      <div className="rounded-md border border-border bg-elevated p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Setup guide</p>
        <ol className="mt-2 space-y-2">
          {guidedSteps.map((step) => {
            const isCurrent = step.state === "current";
            const isDone = step.state === "done";
            return (
              <li key={step.id} className="flex items-start gap-2">
                <span className="mt-0.5">
                  {isDone ? (
                    <CheckCircle2 className="size-4 text-success-indicator" />
                  ) : (
                    <Circle className={`size-4 ${isCurrent ? "text-warning-foreground" : "text-border-strong"}`} />
                  )}
                </span>
                <div>
                  <p className={`text-sm ${isCurrent ? "text-foreground font-medium" : "text-muted-foreground"}`}>{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {checks.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">DNS checks</p>
          {checks.map((check, idx) => (
            <div key={`${check.domain ?? "d"}-${idx}`} className="rounded-md border border-border bg-elevated p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-foreground">
                  <span className="font-semibold">{check.type ?? "record"}</span>{" "}
                  {check.domain ? <span className="font-mono">{check.domain}</span> : null}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => copyText(`check-${idx}-full`, `${check.type ?? "record"} ${check.domain ?? ""} ${check.value ?? ""}`)}
                >
                  {copiedKey === `check-${idx}-full` ? <ClipboardCheck className="size-3.5" /> : <Clipboard className="size-3.5" />}
                  {copiedKey === `check-${idx}-full` ? "Copied" : "Copy record"}
                </Button>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">Type</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-foreground">{check.type ?? "-"}</code>
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => copyText(`check-${idx}-type`, check.type)}>
                      {copiedKey === `check-${idx}-type` ? "copied" : "copy"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">Host</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-foreground break-all">{check.domain ?? "-"}</code>
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => copyText(`check-${idx}-host`, check.domain)}>
                      {copiedKey === `check-${idx}-host` ? "copied" : "copy"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">Value</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-foreground break-all">{check.value ?? "-"}</code>
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => copyText(`check-${idx}-value`, check.value)}>
                      {copiedKey === `check-${idx}-value` ? "copied" : "copy"}
                    </button>
                  </div>
                </div>
              </div>
              {check.reason && <p className="text-xs text-muted-foreground mt-1">{check.reason}</p>}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Use Refresh while waiting on DNS propagation, then Verify to finalize once records resolve.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No verification targets available yet.</p>
      )}
      {domain.last_error_code && (
        <div className="rounded-md border border-destructive-border bg-destructive/20 p-2 text-xs text-destructive-foreground">
          <p className="font-mono">code: {domain.last_error_code}</p>
          {domain.last_error_message && <p className="mt-1">{domain.last_error_message}</p>}
        </div>
      )}
    </div>
  );
}
