"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DomainEventsTimeline, type DomainEventItem } from "@/app/dashboard/components/domains/DomainEventsTimeline";

type MetricsPayload = {
  windowHours: number;
  events: { success: number; error: number; pending: number };
  pendingDomains: number;
  stuckVerifying: number;
  dlqBacklog: number;
};

export default function DomainsAdminPage() {
  const adminUiEnabled = process.env.NEXT_PUBLIC_DOMAINS_ADMIN_UI_ENABLED === "1";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [events, setEvents] = useState<DomainEventItem[]>([]);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session missing");
      const headers = {
        Authorization: `Bearer ${token}`,
        "X-Correlation-Id": crypto.randomUUID(),
      };
      const [metricsRes, eventsRes] = await Promise.all([
        fetch("/api/v1/internal/domains/metrics", { headers }),
        fetch("/api/v1/internal/domains/events?limit=30", { headers }),
      ]);
      const metricsData = await metricsRes.json().catch(() => ({}));
      const eventsData = await eventsRes.json().catch(() => ({}));
      if (!metricsRes.ok) throw new Error(metricsData.error || "Failed metrics fetch");
      if (!eventsRes.ok) throw new Error(eventsData.error || "Failed events fetch");
      setMetrics(metricsData as MetricsPayload);
      setEvents(Array.isArray(eventsData.items) ? (eventsData.items as DomainEventItem[]) : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load domains admin data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!adminUiEnabled) return;
    void loadData();
  }, [adminUiEnabled]);

  if (!adminUiEnabled) {
    return (
      <div className="p-10">
        <h1 className="text-2xl font-semibold">Domains Admin</h1>
        <p className="text-sm text-muted-foreground mt-2">Admin UI disabled by feature flag.</p>
      </div>
    );
  }

  return (
    <div className="p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Domains Admin</h1>
          <p className="text-sm text-muted-foreground">Ops and observability surface for custom domains.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
          <Button
            onClick={async () => {
              setReconcileLoading(true);
              try {
                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) throw new Error("Session missing");
                const res = await fetch("/api/v1/internal/domains/reconcile?limit=100", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "X-Correlation-Id": crypto.randomUUID(),
                  },
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload.error || "Reconcile failed");
                await loadData();
              } catch (e: any) {
                setError(e?.message || "Reconcile failed");
              } finally {
                setReconcileLoading(false);
              }
            }}
            disabled={reconcileLoading}
          >
            {reconcileLoading ? <Loader2 className="size-4 animate-spin" /> : <Wrench size={14} />}
            Trigger Reconcile
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground flex items-center gap-2">
          <ShieldAlert size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card className="border border-border bg-elevated/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Events success</CardTitle>
          </CardHeader>
          <CardContent>{metrics?.events.success ?? 0}</CardContent>
        </Card>
        <Card className="border border-border bg-elevated/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Events error</CardTitle>
          </CardHeader>
          <CardContent>{metrics?.events.error ?? 0}</CardContent>
        </Card>
        <Card className="border border-border bg-elevated/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Events pending</CardTitle>
          </CardHeader>
          <CardContent>{metrics?.events.pending ?? 0}</CardContent>
        </Card>
        <Card className="border border-border bg-elevated/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Stuck verifying</CardTitle>
          </CardHeader>
          <CardContent>{metrics?.stuckVerifying ?? 0}</CardContent>
        </Card>
        <Card className="border border-border bg-elevated/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">DLQ backlog</CardTitle>
          </CardHeader>
          <CardContent>{metrics?.dlqBacklog ?? 0}</CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Recent domain events</h2>
          <Link href="/dashboard/admin/domains/dlq" className="text-sm text-primary-light hover:underline">
            Open DLQ
          </Link>
        </div>
        <DomainEventsTimeline events={events} />
      </div>
    </div>
  );
}
