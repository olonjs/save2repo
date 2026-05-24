"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Terminal } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { ProjectsGrid } from "./components/projects/ProjectsGrid";
import type { ProjectCardProps } from "./components/projects/ProjectCard";
import { CreateTenantModal } from "./components/CreateTenantModal";

// ----------------------------------------------------------------------------
// /dashboard — single-owner projects view.
//
// The owner authenticates with Supabase GitHub OAuth (T-101) and sees their
// tenants. "New Project" opens the 3-step wizard (T-105) that triggers the
// provision-stream SSE (T-106) — the wizard component is the slot for the
// rest of Phase 1 to land into.
//
// Stripped from the jsonpages-platform fork: LemonSqueezy entitlements,
// subscribe-intent flow, preview-bootstrap orchestration. Reason: save2repo
// is single-owner (ADR-002) + billing via Vercel Marketplace (ADR-003), and
// the parent's preview store is out of scope (no tenant_content_store, T-004).
// The `preview_image_url` field is read from DB when present and rendered
// statically by ProjectCard; no client-side refresh loop.
// ----------------------------------------------------------------------------

type Tenant = {
  id: string;
  name?: string | null;
  slug: string;
  github_repo_owner?: string | null;
  github_repo_name?: string | null;
  vercel_url?: string | null;
  vercel_public_url?: string | null;
  preview_image_url?: string | null;
  preview_status?: "pending" | "ready" | "failed" | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadTenants = useCallback(async () => {
    const { data } = await supabase
      .from("tenants")
      .select("*")
      .order("created_at", { ascending: false });
    setTenants(Array.isArray(data) ? (data as Tenant[]) : []);
  }, []);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user: authedUser },
      } = await supabase.auth.getUser();
      if (!authedUser) {
        router.push("/");
        return;
      }
      setUser(authedUser);
      await loadTenants();
      setLoading(false);
    };
    void init();
  }, [router, loadTenants]);

  const handleCreateComplete = useCallback(
    async (tenant: { id: string; name?: string; slug: string }) => {
      setCreateOpen(false);
      await loadTenants();
      if (tenant.id) router.push(`/dashboard/${tenant.id}?tab=overview`);
    },
    [loadTenants, router],
  );

  const cards: ProjectCardProps[] = useMemo(
    () =>
      tenants.map((t) => {
        const publicUrl =
          t.vercel_public_url ||
          t.vercel_url ||
          (t.slug ? `https://${t.slug}.vercel.app` : "#");
        const repoLabel =
          t.github_repo_owner && t.github_repo_name
            ? `${t.github_repo_owner}/${t.github_repo_name}`
            : t.slug;
        return {
          id: t.id,
          name: t.name ?? t.slug,
          slug: t.slug,
          publicUrl,
          repoLabel,
          previewImageUrl: t.preview_image_url ?? null,
          previewStatus: t.preview_status ?? null,
          isLive: Boolean(t.vercel_url || t.vercel_public_url),
        };
      }),
    [tenants],
  );

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-mono text-sm text-muted-foreground">
        <span className="animate-pulse">Loading…</span>
      </div>
    );
  }

  return (
    <>
      <div className="w-full bg-background px-5 pb-10 pt-8">
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-6 px-5">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-display tracking-tight">Projects</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your sovereign tenants.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:border-ring/50 hover:bg-card/70"
            >
              <Plus size={16} /> New Project
            </button>
          </header>

          {cards.length > 0 ? (
            <ProjectsGrid projects={cards} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
                <Terminal size={32} className="text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-foreground">
                No projects yet
              </h3>
              <p className="mb-8 max-w-md text-sm text-muted-foreground">
                Provision a new project from one of the olonjs templates.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:border-ring/50 hover:bg-card/70"
              >
                <Plus size={16} /> New Project
              </button>
            </div>
          )}
        </div>
      </div>

      {createOpen ? (
        <CreateTenantModal
          onClose={() => setCreateOpen(false)}
          onComplete={handleCreateComplete}
        />
      ) : null}
    </>
  );
}
