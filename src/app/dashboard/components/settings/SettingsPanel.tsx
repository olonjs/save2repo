"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TenantRow } from "@/types/database";

// ----------------------------------------------------------------------------
// Settings tab (T-116)
//
// Single-owner tenant operations. First cut covers the delete-tenant flow
// because that is the only destructive op that currently has a backend route
// (DELETE /api/v1/tenants/[id], preserved from parent). Future slices:
//   - rename slug (needs careful Vercel project rename + redirect)
//   - rotate admin keypair (re-mint pgsodium-encrypted private key + reinject
//     ADMIN_PUBLIC_KEY env on the tenant's Vercel project, ADR-002)
//   - tenant Vercel env overrides
// Both deferred to T-116 follow-up slices.
// ----------------------------------------------------------------------------

export function SettingsPanel({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugMatches = confirmText.trim() === tenant.slug;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError("Session expired. Please sign in again.");
        return;
      }
      const res = await fetch(`/api/v1/tenants/${tenant.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `HTTP ${res.status}`);
        setDeleting(false);
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <section className="rounded-lg border border-border bg-card/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Coming soon
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Rename slug (needs Vercel project rename + redirect)</li>
          <li>Rotate admin keypair (ADR-002, ADMIN_PUBLIC_KEY reinject)</li>
          <li>Tenant Vercel env overrides</li>
        </ul>
      </section>

      <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-destructive-foreground">
          <AlertTriangle size={14} /> Danger zone
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Deleting this tenant removes the database row, but does <strong>not</strong> automatically
          delete the GitHub repo (<code className="font-mono">{tenant.github_owner_login}/{tenant.github_repo_name}</code>)
          nor the Vercel project (<code className="font-mono">{tenant.vercel_project_id}</code>).
          Clean those up manually if you no longer want them.
        </p>
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="confirm-slug">
            Type <code className="font-mono">{tenant.slug}</code> to confirm.
          </label>
          <Input
            id="confirm-slug"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant.slug}
            disabled={deleting}
            className="max-w-sm font-mono"
          />
        </div>
        {error ? (
          <p className="mt-3 text-xs text-destructive-foreground">{error}</p>
        ) : null}
        <div className="mt-4">
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!slugMatches || deleting}
          >
            {deleting ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 size={14} className="mr-2" /> Delete tenant
              </>
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}
