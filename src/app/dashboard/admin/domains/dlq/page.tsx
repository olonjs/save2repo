"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type DlqItem = {
  id: string;
  tenant_id: string;
  tenant_domain_id: string | null;
  operation: string;
  domain: string;
  attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  next_retry_at: string | null;
  last_attempt_at: string;
  created_at: string;
  resolved_at: string | null;
};

export default function DomainsDlqPage() {
  const adminUiEnabled = process.env.NEXT_PUBLIC_DOMAINS_ADMIN_UI_ENABLED === "1";
  const [items, setItems] = useState<DlqItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session missing");
      const res = await fetch("/api/v1/internal/domains/dlq?pending=1&limit=200", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed loading DLQ");
      setItems(Array.isArray(payload.items) ? (payload.items as DlqItem[]) : []);
    } catch (e: any) {
      setError(e?.message || "Failed loading DLQ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!adminUiEnabled) return;
    void load();
  }, [adminUiEnabled]);

  if (!adminUiEnabled) {
    return (
      <div className="p-10">
        <h1 className="text-2xl font-semibold">Domains DLQ</h1>
        <p className="text-sm text-muted-foreground mt-2">Admin UI disabled by feature flag.</p>
      </div>
    );
  }

  return (
    <div className="p-10 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/admin/domains" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Domains admin
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Domains DLQ</h1>
          <p className="text-sm text-muted-foreground">Failed domain operations queued for retry.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-elevated text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Domain</th>
              <th className="px-3 py-2 text-left">Operation</th>
              <th className="px-3 py-2 text-left">Attempts</th>
              <th className="px-3 py-2 text-left">Last error</th>
              <th className="px-3 py-2 text-left">Next retry</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-foreground">{item.domain}</td>
                <td className="px-3 py-2 text-muted-foreground">{item.operation}</td>
                <td className="px-3 py-2 text-muted-foreground">{item.attempts}</td>
                <td className="px-3 py-2">
                  <p className="text-xs font-mono text-muted-foreground">{item.last_error_code ?? "n/a"}</p>
                  {item.last_error_message && <p className="text-xs text-muted-foreground">{item.last_error_message}</p>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {item.next_retry_at ? new Date(item.next_retry_at).toLocaleString() : "now"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={async () => {
                        setRetryingId(item.id);
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          const token = session?.access_token;
                          if (!token) throw new Error("Session missing");
                          const res = await fetch(`/api/v1/internal/domains/dlq/${encodeURIComponent(item.id)}/retry`, {
                            method: "POST",
                            headers: {
                              Authorization: `Bearer ${token}`,
                              "X-Correlation-Id": crypto.randomUUID(),
                            },
                          });
                          const payload = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(payload.error || "Retry failed");
                          await load();
                        } catch (e: any) {
                          setError(e?.message || "Retry failed");
                        } finally {
                          setRetryingId(null);
                        }
                      }}
                      disabled={retryingId === item.id}
                    >
                      {retryingId === item.id ? <Loader2 className="size-4 animate-spin" /> : "Retry"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                  No pending DLQ items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
