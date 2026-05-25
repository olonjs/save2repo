"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TenantRow } from "@/types/database";

// ----------------------------------------------------------------------------
// Settings tab (T-116)
//
// Per-tenant operations. Two functional sections + a parked one:
//   - Admin keypair (T-116 slice 2): generate/rotate the EC P-256 keypair
//     used by the deployed tenant Vite app to verify admin-signed JWTs
//     (ADR-002). POST /api/v1/tenants/[id]/admin-keypair generates the pair,
//     stores `admin_private_key` (pgsodium-encrypted) + `admin_public_key`
//     in `tenants`, and best-effort pushes ADMIN_PUBLIC_KEY to the tenant's
//     Vercel project env (so the next deploy picks it up).
//   - Danger zone (T-116 slice 1): delete tenant.
//   - Rename slug + Vercel env overrides remain TODO.
// ----------------------------------------------------------------------------

export function SettingsPanel({ tenant }: { tenant: TenantRow }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <AdminKeypairSection tenant={tenant} />
      <ComingSoonSection />
      <DangerZone tenant={tenant} />
    </div>
  );
}

// ---------------------------------------------------------------------------- admin keypair

type KeypairResponse = {
  publicKey?: string;
  vercelPushStatus?: "skipped" | "pushed" | "failed";
  vercelPushError?: string | null;
  error?: string;
  code?: string;
};

function AdminKeypairSection({ tenant }: { tenant: TenantRow }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeypairResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const isRotation = Boolean(tenant.admin_public_key);

  const handleGenerate = async () => {
    if (isRotation && !confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError("Session expired. Please sign in again.");
        return;
      }
      const res = await fetch(`/api/v1/tenants/${tenant.id}/admin-keypair`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as KeypairResponse;
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      setConfirmRotate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <KeyRound size={14} /> Admin keypair
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        EC P-256 keypair used by the tenant site to verify admin-signed tokens (ADR-002).
        The private key is stored encrypted (pgsodium) and never shown again after generation.
        The public key is automatically pushed to the tenant Vercel project as <code className="font-mono">ADMIN_PUBLIC_KEY</code>;
        the next deploy will pick it up.
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <StatusDot ok={isRotation} />
        <span className="text-muted-foreground">
          {isRotation ? "Keypair generated. Rotation will invalidate all previously issued admin tokens." : "No keypair yet."}
        </span>
      </div>

      {confirmRotate && !busy ? (
        <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          Confirm rotation: click again to overwrite the existing keypair. All previously issued admin tokens will stop being accepted.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs text-destructive-foreground">{error}</p>
      ) : null}

      <div className="mt-4">
        <Button type="button" onClick={handleGenerate} disabled={busy} variant={isRotation ? "outline" : "default"}>
          {busy ? (
            <>
              <Loader2 size={14} className="mr-2 animate-spin" /> Generating…
            </>
          ) : isRotation ? (
            <>
              <RefreshCw size={14} className="mr-2" /> {confirmRotate ? "Confirm rotation" : "Rotate admin keypair"}
            </>
          ) : (
            <>
              <KeyRound size={14} className="mr-2" /> Generate admin keypair
            </>
          )}
        </Button>
      </div>

      {result?.publicKey ? (
        <div className="mt-4 space-y-2 rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Public key (PEM)</span>
            <div className="flex items-center gap-2">
              <VercelPushBadge status={result.vercelPushStatus} error={result.vercelPushError ?? null} />
              <CopyButton text={result.publicKey} />
            </div>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
            {result.publicKey}
          </pre>
          {result.vercelPushStatus !== "pushed" ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {result.vercelPushStatus === "failed"
                ? `Vercel env push failed: ${result.vercelPushError ?? "unknown"}. Copy the public key above and set it as ADMIN_PUBLIC_KEY manually on the tenant Vercel project.`
                : "ADMIN_PUBLIC_KEY env not pushed automatically (Vercel not connected for this owner). Set it manually."}
            </p>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              ADMIN_PUBLIC_KEY pushed to Vercel project. Trigger a redeploy for it to be picked up.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      aria-hidden
    />
  );
}

function VercelPushBadge({ status, error }: { status?: KeypairResponse["vercelPushStatus"]; error: string | null }) {
  if (status === "pushed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <Check size={10} /> Pushed to Vercel
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span title={error ?? undefined} className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
        Push failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Manual push needed
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied */
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ---------------------------------------------------------------------------- coming soon

function ComingSoonSection() {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Coming soon
      </h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Rename slug (Vercel project rename + redirect)</li>
        <li>Tenant Vercel env overrides</li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------- danger zone

function DangerZone({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slugMatches = confirmText.trim() === tenant.slug;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={!slugMatches || deleting}>
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
  );
}
