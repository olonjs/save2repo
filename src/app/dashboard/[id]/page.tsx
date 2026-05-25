"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Github,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { DomainsPanel } from "@/app/dashboard/components/domains/DomainsPanel";
import { LeadsPanel } from "@/app/dashboard/components/leads/LeadsPanel";
import { AgentsPanel } from "@/app/dashboard/components/agents/AgentsPanel";
import type { TenantRow } from "@/types/database";

// ----------------------------------------------------------------------------
// /dashboard/[id]?tab=<overview|domains|leads|agents|settings>  (T-113)
//
// Single-owner tenant detail shell. Replaces the 1158-line parent code that
// carried 5+ tabs depending on routes deleted in T-003/T-004 (Snapshot,
// Cold-save, HotSave Overview buttons, Leads pre-T-114, Billing entirely).
//
// Layout:
//   header     ← slug · status badge · external links · actions
//   tab nav    ← Overview · Domains · Leads · Agents · Settings
//   tab body   ← per-tab content
//
// Stripped vs parent:
//   - Billing tab (out of scope, ADR-003 — Vercel Marketplace native billing)
//   - Snapshot / Cold-save / HotSave buttons in Overview (ADR-005 — save = commit)
//   - LemonSqueezy entitlements / subscribe flow
//   - Preview-bootstrap polling loop
//
// Tab readiness (per save2repo-tasks.md Phase 1):
//   Overview ✓ (this file)
//   Domains  ✓ (DomainsPanel + T-109 routes)
//   Leads    ⚠ placeholder until T-114 backend restore
//   Agents   ⚠ placeholder until T-110 MCP lands
//   Settings ⚠ placeholder until T-116 lands
// ----------------------------------------------------------------------------

type Tab = "overview" | "domains" | "leads" | "agents" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }>; ready: boolean; placeholder?: string }[] = [
  { id: "overview", label: "Overview", icon: Globe, ready: true },
  { id: "domains", label: "Domains", icon: Globe, ready: true },
  { id: "leads", label: "Leads", icon: AlertCircle, ready: true },
  { id: "agents", label: "Agents", icon: Plug, ready: true },
  { id: "settings", label: "Settings", icon: KeyRound, ready: false, placeholder: "Settings tab lands with T-116 (rename / rotate keypair / delete)." },
];

function isTab(value: string | null): value is Tab {
  return value === "overview" || value === "domains" || value === "leads" || value === "agents" || value === "settings";
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tenantId = params.id;
  const activeTab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "overview";

  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // ----- Init + fetch -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: authedUser } } = await supabase.auth.getUser();
      if (!authedUser) {
        router.push("/");
        return;
      }
      if (cancelled) return;
      setUser(authedUser);
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .eq("owner_user_id", authedUser.id)
        .maybeSingle<TenantRow>();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setTenant(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, router]);

  const setTab = useCallback(
    (tab: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`/dashboard/${tenantId}?${params.toString()}`);
    },
    [tenantId, router, searchParams],
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-mono text-sm text-muted-foreground">
        <Loader2 size={18} className="mr-2 animate-spin" /> Loading…
      </div>
    );
  }

  if (notFound || !tenant) {
    return (
      <div className="mx-auto w-full max-w-screen-xl px-5 py-10">
        <p className="text-sm text-muted-foreground">Project not found, or not owned by the current user.</p>
        <Link href="/dashboard" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft size={14} /> Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-xl px-5 py-8">
      <TenantHeader tenant={tenant} />
      <TabBar active={activeTab} onChange={setTab} />
      <div className="mt-6">
        {activeTab === "overview" ? (
          <OverviewTab tenant={tenant} />
        ) : activeTab === "domains" ? (
          <DomainsPanel tenantId={tenant.id} />
        ) : activeTab === "leads" ? (
          <LeadsPanel tenantId={tenant.id} />
        ) : activeTab === "agents" ? (
          <AgentsPanel tenantId={tenant.id} tenantSlug={tenant.slug} />
        ) : (
          <PlaceholderTab tab={activeTab} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- header

function StatusBadge({ status }: { status: string }) {
  const colour =
    status === "ready"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "provisioning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colour}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {status}
    </span>
  );
}

function TenantHeader({ tenant }: { tenant: TenantRow }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1.5">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={12} /> Back to projects
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl tracking-tight">{tenant.display_name || tenant.slug}</h1>
          <StatusBadge status={tenant.status} />
        </div>
        <p className="font-mono text-xs text-muted-foreground">{tenant.slug}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/${tenant.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-ring/50 hover:bg-card/70"
        >
          <Pencil size={14} /> Edit
        </Link>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------- tab bar

function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="mt-6 flex flex-wrap items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {!t.ready ? (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">soon</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------- overview tab

function OverviewTab({ tenant }: { tenant: TenantRow }) {
  const publicUrl = tenant.vercel_public_url || tenant.vercel_url || null;
  const repoLabel =
    tenant.github_owner_login && tenant.github_repo_name
      ? `${tenant.github_owner_login}/${tenant.github_repo_name}`
      : null;
  const repoUrl = repoLabel ? `https://github.com/${repoLabel}` : null;
  const createdAt = tenant.created_at ? new Date(tenant.created_at).toLocaleString() : "—";

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Live site" icon={Globe}>
          {publicUrl ? (
            <ExternalLinkRow href={publicUrl} label={publicUrl.replace(/^https?:\/\//, "")} />
          ) : (
            <Muted>Not deployed yet.</Muted>
          )}
        </Card>
        <Card title="GitHub repository" icon={Github}>
          {repoUrl ? (
            <ExternalLinkRow href={repoUrl} label={repoLabel!} />
          ) : (
            <Muted>No repository linked.</Muted>
          )}
        </Card>
      </section>
      <section className="rounded-lg border border-border bg-card/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
        <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[auto,1fr] sm:gap-x-6">
          <Detail label="ID" value={tenant.id} mono />
          <Detail label="Slug" value={tenant.slug} mono />
          <Detail label="Deployment target" value={tenant.deployment_target} />
          <Detail label="Status" value={tenant.status} />
          <Detail label="Vercel project" value={tenant.vercel_project_id || "—"} mono />
          <Detail label="GitHub repo id" value={tenant.github_repo_id?.toString() || "—"} mono />
          <Detail label="Created" value={createdAt} />
        </dl>
      </section>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon size={14} /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ExternalLinkRow({ href, label }: { href: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-mono text-sm text-primary hover:underline"
      >
        {label} <ExternalLink size={12} />
      </a>
      <CopyButton text={href} />
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground sm:py-0.5">{label}</dt>
      <dd className={`${mono ? "font-mono" : ""} break-all sm:py-0.5`}>{value}</dd>
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied */
        }
      }}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Copy"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

// ---------------------------------------------------------------------------- placeholder for not-yet-ready tabs

function PlaceholderTab({ tab }: { tab: Tab }) {
  const meta = TABS.find((t) => t.id === tab);
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 p-12 text-center">
      <p className="text-sm text-muted-foreground">{meta?.placeholder ?? "Tab not implemented yet."}</p>
    </div>
  );
}

// Lint: keep these imports referenced so future tabs can be wired without re-importing.
void Trash2;
