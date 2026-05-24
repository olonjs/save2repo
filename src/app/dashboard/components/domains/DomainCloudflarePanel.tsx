"use client";

import { useState } from "react";
import { Clipboard, ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DomainRecord } from "./types";

type Props = {
  domain: DomainRecord;
  busy?: boolean;
  onConnect: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
};

export function DomainCloudflarePanel({ domain, busy, onConnect, onRefresh, onDisconnect }: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyNs = async (ns: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(ns);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((prev) => (prev === idx ? null : prev)), 1200);
    } catch {
      setCopiedIdx(null);
    }
  };

  const cfStatus = domain.cf_status ?? null;
  const nameServers = domain.cf_nameservers ?? [];

  return (
    <div className="rounded-md border border-border bg-elevated p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Cloudflare</p>
        {cfStatus === "active" && (
          <span className="text-xs rounded px-2 py-0.5 bg-success-indicator/10 text-success-indicator border border-success-indicator/30">
            Active
          </span>
        )}
        {cfStatus === "pending_ns" && (
          <span className="text-xs rounded px-2 py-0.5 bg-warning-foreground/10 text-warning-foreground border border-warning-foreground/30">
            Pending NS
          </span>
        )}
        {cfStatus === "error" && (
          <span className="text-xs rounded px-2 py-0.5 bg-destructive/20 text-destructive-foreground border border-destructive-border">
            Error
          </span>
        )}
        {cfStatus === "disconnected" && (
          <span className="text-xs rounded px-2 py-0.5 bg-muted text-muted-foreground border border-border">
            Disconnected
          </span>
        )}
        {!cfStatus && (
          <span className="text-xs rounded px-2 py-0.5 bg-muted text-muted-foreground border border-border">
            Not connected
          </span>
        )}
      </div>

      {!cfStatus && (
        <>
          <p className="text-xs text-muted-foreground">
            Connect this domain to Cloudflare to manage DNS records and enable proxy/CDN.
          </p>
          <Button type="button" size="sm" onClick={onConnect} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Connect Cloudflare
          </Button>
        </>
      )}

      {cfStatus === "pending_ns" && nameServers.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            Update your domain registrar to use these Cloudflare nameservers. Status updates automatically once
            the change is detected (typically within minutes, up to 24h).
          </p>
          <div className="space-y-1">
            {nameServers.map((ns, idx) => (
              <div key={ns} className="flex items-center justify-between gap-2 text-xs">
                <code className="font-mono text-foreground break-all">{ns}</code>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  onClick={() => copyNs(ns, idx)}
                >
                  {copiedIdx === idx ? <ClipboardCheck className="size-3.5" /> : <Clipboard className="size-3.5" />}
                  {copiedIdx === idx ? "copied" : "copy"}
                </button>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Check status
          </Button>
        </>
      )}

      {cfStatus === "active" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Zone <code className="font-mono">{domain.cf_zone_id}</code> is active. DNS management is available
            for this domain.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              if (!window.confirm("Disconnect Cloudflare from the platform? The zone will keep existing on Cloudflare and you can still manage it from dash.cloudflare.com.")) return;
              await onDisconnect();
            }}
            disabled={busy}
          >
            Disconnect Cloudflare
          </Button>
        </div>
      )}

      {cfStatus === "disconnected" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Cloudflare has been unlinked from the platform. The zone still exists on Cloudflare (zone id
            <code className="ml-1 font-mono">{domain.cf_zone_id}</code>). Reconnect at any time.
          </p>
          <Button type="button" size="sm" onClick={onConnect} disabled={busy}>
            Reconnect Cloudflare
          </Button>
        </div>
      )}

      {cfStatus === "error" && (
        <div className="space-y-2">
          <p className="text-xs text-destructive-foreground">
            {domain.cf_last_error_message ?? "Cloudflare reported an error."}
          </p>
          {domain.cf_last_error_code && (
            <p className="text-xs font-mono text-muted-foreground">code: {domain.cf_last_error_code}</p>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onConnect} disabled={busy}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
