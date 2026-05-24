"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DnsRecord, DnsRecordInput, DnsRecordType } from "./types";

const RECORD_TYPES: DnsRecordType[] = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"];

const PROXYABLE: Record<string, boolean> = {
  A: true,
  AAAA: true,
  CNAME: true,
};

const NEEDS_PRIORITY: Record<string, boolean> = {
  MX: true,
  SRV: true,
};

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  initial?: DnsRecord | null;
  onClose: () => void;
  onSubmit: (input: DnsRecordInput) => Promise<void>;
};

export function DnsRecordForm({ open, mode, initial, onClose, onSubmit }: Props) {
  const [type, setType] = useState<DnsRecordType>((initial?.type as DnsRecordType) ?? "A");
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [content, setContent] = useState<string>(initial?.content ?? "");
  const [ttl, setTtl] = useState<number>(initial?.ttl ?? 1);
  const [proxied, setProxied] = useState<boolean>(initial?.proxied ?? false);
  const [priority, setPriority] = useState<number>(initial?.priority ?? 10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: DnsRecordInput = {
        type,
        name: name.trim(),
        content: content.trim(),
        ttl,
      };
      if (PROXYABLE[type]) payload.proxied = proxied;
      if (NEEDS_PRIORITY[type]) payload.priority = priority;
      await onSubmit(payload);
      onClose();
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message ?? "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add DNS record" : "Edit DNS record"}</DialogTitle>
          <DialogDescription>
            Changes are applied live on Cloudflare. TTL = 1 means automatic.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 col-span-1">
              <Label htmlFor="dns-type">Type</Label>
              <select
                id="dns-type"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as DnsRecordType)}
                disabled={mode === "edit"}
              >
                {RECORD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label htmlFor="dns-name">Name</Label>
              <Input
                id="dns-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. @ or www or sub.example.com"
                disabled={mode === "edit"}
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dns-content">Content</Label>
            <Input
              id="dns-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                type === "A"
                  ? "192.0.2.1"
                  : type === "AAAA"
                  ? "2001:db8::1"
                  : type === "CNAME"
                  ? "target.example.com"
                  : type === "TXT"
                  ? "v=spf1 ..."
                  : type === "MX"
                  ? "mail.example.com"
                  : ""
              }
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="dns-ttl">TTL</Label>
              <Input
                id="dns-ttl"
                type="number"
                min={1}
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value) || 1)}
              />
            </div>
            {NEEDS_PRIORITY[type] && (
              <div className="space-y-1">
                <Label htmlFor="dns-priority">Priority</Label>
                <Input
                  id="dns-priority"
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 0)}
                />
              </div>
            )}
            {PROXYABLE[type] && (
              <div className="space-y-1">
                <Label htmlFor="dns-proxied">Proxy</Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id="dns-proxied"
                    type="checkbox"
                    checked={proxied}
                    onChange={(e) => setProxied(e.target.checked)}
                  />
                  <span className="text-muted-foreground">Proxy via Cloudflare</span>
                </label>
              </div>
            )}
          </div>
          {error && (
            <div className="rounded border border-destructive-border bg-destructive/20 p-2 text-xs text-destructive-foreground">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {mode === "create" ? "Add record" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
