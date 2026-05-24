"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Pencil, Plus, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  apiCreateDnsRecord,
  apiDeleteDnsRecord,
  apiListDnsRecords,
  apiUpdateDnsRecord,
} from "./api";
import type { DnsRecord, DnsRecordInput } from "./types";
import { DnsRecordForm } from "./DnsRecordForm";

type Props = {
  tenantId: string;
  domain: string;
};

export function DnsRecordsPanel({ tenantId, domain }: Props) {
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DnsRecord | null>(null);
  const [proxyBusy, setProxyBusy] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiListDnsRecords(tenantId, domain);
      setRecords(rows);
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message ?? "Failed to load DNS records");
    } finally {
      setLoading(false);
    }
  }, [tenantId, domain]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (input: DnsRecordInput) => {
    const created = await apiCreateDnsRecord(tenantId, domain, input);
    setRecords((prev) => [created, ...prev]);
  };

  const onEdit = async (input: DnsRecordInput) => {
    if (!editing) return;
    const updated = await apiUpdateDnsRecord(tenantId, domain, editing.id, {
      content: input.content,
      ttl: input.ttl,
      proxied: input.proxied,
      priority: input.priority,
    });
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const onToggleProxy = async (record: DnsRecord) => {
    if (record.platform_managed) return;
    setProxyBusy(record.id);
    setError(null);
    try {
      const updated = await apiUpdateDnsRecord(tenantId, domain, record.id, {
        proxied: !record.proxied,
      });
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message ?? "Failed to toggle proxy");
    } finally {
      setProxyBusy(null);
    }
  };

  const onDelete = async (record: DnsRecord) => {
    if (record.platform_managed) return;
    if (!window.confirm(`Delete ${record.type} record "${record.name}"?`)) return;
    setDeleteBusy(record.id);
    setError(null);
    try {
      await apiDeleteDnsRecord(tenantId, domain, record.id);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message ?? "Failed to delete record");
    } finally {
      setDeleteBusy(null);
    }
  };

  const isProxyable = (record: DnsRecord) =>
    record.type === "A" || record.type === "AAAA" || record.type === "CNAME";

  return (
    <div className="rounded-md border border-border bg-elevated p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">DNS records</p>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Add record
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive-border bg-destructive/20 p-2 text-xs text-destructive-foreground">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-elevated/80">
        <table className="w-full text-xs">
          <thead className="bg-elevated text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium w-20">Type</th>
              <th className="px-2 py-1.5 text-left font-medium">Name</th>
              <th className="px-2 py-1.5 text-left font-medium">Content</th>
              <th className="px-2 py-1.5 text-left font-medium w-16">TTL</th>
              <th className="px-2 py-1.5 text-left font-medium w-24">Proxy</th>
              <th className="px-2 py-1.5 text-right font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                  No DNS records.
                </td>
              </tr>
            )}
            {records.map((record) => {
              const proxyable = isProxyable(record);
              const isManaged = !!record.platform_managed;
              return (
                <tr key={record.id} className="border-t border-border align-top">
                  <td className="px-2 py-1.5 text-foreground font-mono">{record.type}</td>
                  <td className="px-2 py-1.5 text-foreground font-mono break-all">
                    {record.name}
                    {isManaged && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground border border-border">
                        <Lock className="size-2.5" />
                        managed
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-foreground font-mono break-all">{record.content}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{record.ttl === 1 ? "auto" : record.ttl}</td>
                  <td className="px-2 py-1.5">
                    {proxyable ? (
                      <button
                        type="button"
                        className={`text-xs rounded px-2 py-0.5 border ${
                          record.proxied
                            ? "bg-warning-foreground/10 text-warning-foreground border-warning-foreground/30"
                            : "bg-muted text-muted-foreground border-border"
                        } ${isManaged ? "opacity-50 cursor-not-allowed" : "hover:bg-warning-foreground/20"}`}
                        onClick={() => void onToggleProxy(record)}
                        disabled={isManaged || proxyBusy === record.id}
                      >
                        {proxyBusy === record.id ? "…" : record.proxied ? "Proxied" : "DNS only"}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        title={isManaged ? "Managed records cannot be edited" : "Edit"}
                        disabled={isManaged}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => {
                          if (isManaged) return;
                          setEditing(record);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title={isManaged ? "Managed records cannot be deleted" : "Delete"}
                        disabled={isManaged || deleteBusy === record.id}
                        className="rounded p-1 text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void onDelete(record)}
                      >
                        {deleteBusy === record.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <DnsRecordForm
          open={formOpen}
          mode={editing ? "edit" : "create"}
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={editing ? onEdit : onCreate}
        />
      )}
    </div>
  );
}
