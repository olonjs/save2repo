"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DomainsPanel } from "@/app/dashboard/components/domains/DomainsPanel";
import { LeadsPanel } from "@/app/dashboard/components/leads/LeadsPanel";
import { AgentsPanel } from "@/app/dashboard/components/agents/AgentsPanel";
import {
  ArrowLeft,
  Globe,
  GitBranch,
  CreditCard,
  Inbox,
  Copy,
  Check,
  Loader2,
  Database,
  Settings,
  X,
  Plug,
  Lock,
} from "lucide-react";

interface Tenant {
  id: string;
  // DB column: display_name (nullable). Parent code referenced `name`; we keep
  // the local prop as a derived best-effort fallback to display_name ?? slug.
  name: string;
  slug: string;
  vercel_url?: string | null;
  vercel_public_url?: string | null;
  // DB columns: github_owner_login + github_repo_name (both nullable).
  // Parent referenced github_repo_owner — renamed here to match the DB SOT
  // (save2repo Supabase generated types in src/types/database.ts).
  github_owner_login: string | null;
  github_repo_name: string | null;
  github_installation_id?: string;
  vercel_project_id?: string | null;
  admin_private_key?: string | null;
  status?: string;
  created_at?: string;
}

type BillingSummary = {
  planCode: "starter" | "pro" | "business" | null;
  status: "active" | "past_due" | "unknown";
  renewalAt: string | null;
  currentPeriodEnd: string | null;
  entitlementCount: number;
  canManageBilling: boolean;
};

type SnapshotStepId = "gather_repo" | "map_content" | "write_store" | "finalize";
type SnapshotStepStatus = "idle" | "running" | "done" | "error";
type SnapshotStepState = { id: SnapshotStepId; label: string; status: SnapshotStepStatus };

const SNAPSHOT_STEPS: SnapshotStepState[] = [
  { id: "gather_repo", label: "Lettura repository", status: "idle" },
  { id: "map_content", label: "Mapping contenuti", status: "idle" },
  { id: "write_store", label: "Scrittura su Supabase", status: "idle" },
  { id: "finalize", label: "Finalize", status: "idle" },
];

type ColdSaveStepId = "gather_store" | "commit" | "build" | "live";
type ColdSaveStepState = { id: ColdSaveStepId; label: string; status: SnapshotStepStatus };

const COLD_SAVE_STEPS: ColdSaveStepState[] = [
  { id: "gather_store", label: "Lettura Supabase store", status: "idle" },
  { id: "commit", label: "Commit su GitHub", status: "idle" },
  { id: "build", label: "Build Vercel", status: "idle" },
  { id: "live", label: "Deploy live", status: "idle" },
];

type SseEventRecord = { event: string; data: string };

function parseSseChunk(chunk: string): SseEventRecord[] {
  const blocks = chunk.split("\n\n");
  const events: SseEventRecord[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return events;
}

const TABS = [
  { id: "overview", label: "Overview", icon: Globe },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "agents", label: "API/Agents", icon: Plug },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

function CopyButton({ text, size = 14 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={handle}
      title="Copia"
      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id as string;
  const tabFromUrl = searchParams?.get("tab") || "overview";
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(tabFromUrl);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotRunning, setSnapshotRunning] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotCorrelationId, setSnapshotCorrelationId] = useState<string | null>(null);
  const [snapshotLogs, setSnapshotLogs] = useState<string[]>([]);
  const [snapshotSteps, setSnapshotSteps] = useState<SnapshotStepState[]>(SNAPSHOT_STEPS);
  const [snapshotResult, setSnapshotResult] = useState<{
    entitiesWritten: number;
    pagesWritten: number;
    configWritten: number;
  } | null>(null);
  const [coldSaveOpen, setColdSaveOpen] = useState(false);
  const [coldSaveRunning, setColdSaveRunning] = useState(false);
  const [coldSaveError, setColdSaveError] = useState<string | null>(null);
  const [coldSaveCorrelationId, setColdSaveCorrelationId] = useState<string | null>(null);
  const [coldSaveLogs, setColdSaveLogs] = useState<string[]>([]);
  const [coldSaveSteps, setColdSaveSteps] = useState<ColdSaveStepState[]>(COLD_SAVE_STEPS);
  const [coldSaveResult, setColdSaveResult] = useState<{
    filesWritten: number;
    deployUrl?: string;
    commitSha?: string;
  } | null>(null);
  const [generatingKeypair, setGeneratingKeypair] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [keypairError, setKeypairError] = useState<string | null>(null);
  const [adminAccessLoading, setAdminAccessLoading] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    if (!id) return;
    const fetchTenant = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
        return;
      }
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", id)
        .eq("owner_user_id", user.id)
        .single();
      if (error || !data) {
        setTenant(null);
        setLoading(false);
        return;
      }
      // Map DB row (display_name nullable) → local Tenant prop (name string fallback to slug).
      const row = data as Record<string, unknown>;
      setTenant({
        ...(row as object),
        name: (typeof row.display_name === "string" ? row.display_name : null) ?? (typeof row.slug === "string" ? row.slug : ""),
      } as Tenant);
      setLoading(false);
    };
    fetchTenant();
  }, [id, router]);

  const loadBillingSummary = useCallback(async () => {
    if (!tenant?.id) return;
    setBillingLoading(true);
    setBillingError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Sessione assente o scaduta");
      }
      const url = new URL("/api/v1/licensing/subscription-summary", window.location.origin);
      url.searchParams.set("tenant_id", tenant.id);
      url.searchParams.set("correlation_id", crypto.randomUUID());
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Errore caricamento subscription");
      }
      setBillingSummary({
        planCode:
          data.planCode === "business" || data.planCode === "pro" || data.planCode === "starter"
            ? data.planCode
            : null,
        status: data.status === "active" || data.status === "past_due" ? data.status : "unknown",
        renewalAt: typeof data.renewalAt === "string" ? data.renewalAt : null,
        currentPeriodEnd: typeof data.currentPeriodEnd === "string" ? data.currentPeriodEnd : null,
        entitlementCount: Number.isFinite(data.entitlementCount) ? Number(data.entitlementCount) : 0,
        canManageBilling: Boolean(data.canManageBilling),
      });
    } catch (error: any) {
      setBillingError(error?.message || "Errore durante il caricamento subscription");
    } finally {
      setBillingLoading(false);
    }
  }, [tenant?.id]);

  const handleManageBilling = useCallback(async () => {
    if (!tenant?.id || billingPortalLoading) return;
    setBillingPortalLoading(true);
    setBillingError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Sessione assente o scaduta");
      }
      const url = new URL("/api/v1/licensing/portal", window.location.origin);
      url.searchParams.set("tenant_id", tenant.id);
      url.searchParams.set("correlation_id", crypto.randomUUID());
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.portalUrl !== "string") {
        throw new Error(data.error || "Portal billing non disponibile");
      }
      window.location.href = data.portalUrl;
    } catch (error: any) {
      setBillingError(error?.message || "Impossibile aprire il billing portal");
    } finally {
      setBillingPortalLoading(false);
    }
  }, [tenant?.id, billingPortalLoading]);

  useEffect(() => {
    if (activeTab !== "billing" || !tenant?.id) return;
    void loadBillingSummary();
  }, [activeTab, tenant?.id, loadBillingSummary]);

  const setTab = (tab: string) => {
    setActiveTab(tab);
    const u = new URLSearchParams(searchParams?.toString() || "");
    u.set("tab", tab);
    router.replace(`/dashboard/${id}?${u.toString()}`, { scroll: false });
  };

  const runHotSaveSnapshot = useCallback(async () => {
    if (!tenant?.id || snapshotRunning) return;
    setSnapshotOpen(true);
    setSnapshotRunning(true);
    setSnapshotError(null);
    setSnapshotCorrelationId(null);
    setSnapshotLogs([]);
    setSnapshotResult(null);
    setSnapshotSteps(SNAPSHOT_STEPS.map((step) => ({ ...step, status: "idle" })));

    const appendLog = (line: string) => {
      setSnapshotLogs((prev) => [...prev, line]);
    };
    const markStep = (stepId: SnapshotStepId, status: SnapshotStepStatus) => {
      setSnapshotSteps((prev) =>
        prev.map((step) => (step.id === stepId ? { ...step, status } : step))
      );
    };

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sessione assente o scaduta");
      const correlationId = crypto.randomUUID();
      setSnapshotCorrelationId(correlationId);

      const res = await fetch(`/api/v1/tenants/${tenant.id}/save2edge-snapshot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneReceived = false;
      while (true) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) buffer += decoder.decode();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const records = parseSseChunk(part + "\n\n");
          for (const record of records) {
            const data = (() => {
              try {
                return JSON.parse(record.data) as Record<string, unknown>;
              } catch {
                return {};
              }
            })();
            if (record.event === "step") {
              const stepId = data.id as SnapshotStepId;
              const status = data.status as SnapshotStepStatus;
              if (stepId && status) {
                markStep(stepId, status);
              }
            } else if (record.event === "log") {
              const message = typeof data.message === "string" ? data.message : "log";
              appendLog(message);
            } else if (record.event === "error") {
              const message = typeof data.message === "string" ? data.message : "Snapshot failed";
              const cid = typeof data.correlationId === "string" ? data.correlationId : null;
              if (cid) setSnapshotCorrelationId(cid);
              appendLog(`ERROR: ${message}`);
              setSnapshotError(message);
              const stepId = data.stepId as SnapshotStepId | undefined;
              if (stepId) markStep(stepId, "error");
            } else if (record.event === "done") {
              doneReceived = true;
              setSnapshotResult({
                entitiesWritten: Number(data.entitiesWritten ?? 0),
                pagesWritten: Number(data.pagesWritten ?? 0),
                configWritten: Number(data.configWritten ?? 0),
              });
              appendLog("Snapshot completato.");
            }
          }
        }
        if (done) break;
      }
      if (!doneReceived && !snapshotError) {
        setSnapshotError("Stream terminato senza evento finale.");
      }
    } catch (error: any) {
      setSnapshotError(error?.message || "Errore durante HotSave snapshot");
    } finally {
      setSnapshotRunning(false);
    }
  }, [tenant?.id, snapshotRunning, snapshotError]);

  const runColdSave = useCallback(async () => {
    if (!tenant?.id || coldSaveRunning) return;
    setColdSaveOpen(true);
    setColdSaveRunning(true);
    setColdSaveError(null);
    setColdSaveCorrelationId(null);
    setColdSaveLogs([]);
    setColdSaveResult(null);
    setColdSaveSteps(COLD_SAVE_STEPS.map((step) => ({ ...step, status: "idle" })));

    const appendLog = (line: string) => {
      setColdSaveLogs((prev) => [...prev, line]);
    };
    const markStep = (stepId: ColdSaveStepId, status: SnapshotStepStatus) => {
      setColdSaveSteps((prev) => prev.map((step) => (step.id === stepId ? { ...step, status } : step)));
    };

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sessione assente o scaduta");
      const correlationId = crypto.randomUUID();
      setColdSaveCorrelationId(correlationId);

      const res = await fetch(`/api/v1/tenants/${tenant.id}/cold-save`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneReceived = false;
      let streamErrored = false;
      while (true) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) buffer += decoder.decode();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const records = parseSseChunk(part + "\n\n");
          for (const record of records) {
            const data = (() => {
              try {
                return JSON.parse(record.data) as Record<string, unknown>;
              } catch {
                return {};
              }
            })();
            if (record.event === "step") {
              const stepId = data.id as ColdSaveStepId;
              const status = data.status as SnapshotStepStatus;
              if (stepId && status) {
                markStep(stepId, status);
              }
            } else if (record.event === "log") {
              const message = typeof data.message === "string" ? data.message : "log";
              appendLog(message);
            } else if (record.event === "error") {
              streamErrored = true;
              const message = typeof data.message === "string" ? data.message : "Cold save failed";
              const cid = typeof data.correlationId === "string" ? data.correlationId : null;
              if (cid) setColdSaveCorrelationId(cid);
              appendLog(`ERROR: ${message}`);
              setColdSaveError(message);
              const stepId = data.stepId as ColdSaveStepId | undefined;
              if (stepId) markStep(stepId, "error");
            } else if (record.event === "done") {
              doneReceived = true;
              const filesWritten = Number(data.filesWritten ?? 0);
              const deployUrl = typeof data.deployUrl === "string" ? data.deployUrl : undefined;
              const commitSha = typeof data.commitSha === "string" ? data.commitSha : undefined;
              setColdSaveResult({ filesWritten, deployUrl, commitSha });
              if (deployUrl) {
                setTenant((prev) => (prev ? { ...prev, vercel_url: deployUrl } : prev));
              }
              appendLog("Cold save completato.");
            }
          }
        }
        if (done) break;
      }
      if (!doneReceived && !streamErrored) {
        setColdSaveError("Stream terminato senza evento finale.");
      }
    } catch (error: unknown) {
      setColdSaveError(error instanceof Error ? error.message : "Errore durante Cold save");
    } finally {
      setColdSaveRunning(false);
    }
  }, [tenant?.id, coldSaveRunning]);

  const handleGenerateKeypair = useCallback(async () => {
    if (!tenant?.id || generatingKeypair) return;
    setGeneratingKeypair(true);
    setGeneratedPublicKey(null);
    setKeypairError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione assente o scaduta");
      const res = await fetch(`/api/v1/tenants/${tenant.id}/admin-keypair`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setGeneratedPublicKey(data.publicKey as string);
      setTenant((prev) => prev ? { ...prev, admin_private_key: "configured" } : prev);
    } catch (error: unknown) {
      setKeypairError(error instanceof Error ? error.message : "Errore generazione keypair");
    } finally {
      setGeneratingKeypair(false);
    }
  }, [tenant?.id, generatingKeypair]);

  const handleDeleteProject = useCallback(async () => {
    if (!tenant?.id || deleteLoading) return;
    setDeleteError(null);
    if (deleteConfirmText.trim() !== tenant.slug) {
      setDeleteError(`Scrivi esattamente lo slug "${tenant.slug}" per confermare.`);
      return;
    }
    const confirmed = window.confirm(
      `Eliminare definitivamente il progetto "${tenant.name}"? Questa azione non puo essere annullata.`
    );
    if (!confirmed) return;

    setDeleteLoading(true);
    try {
      if (!deleteIdempotencyKeyRef.current) {
        deleteIdempotencyKeyRef.current = crypto.randomUUID();
      }
      const idempotencyKey = deleteIdempotencyKeyRef.current;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Sessione assente o scaduta");
      }
      const res = await fetch(`/api/v1/tenants/${tenant.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
          "Idempotency-Key": idempotencyKey,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Delete progetto fallita");
      }
      router.push("/dashboard");
    } catch (error: any) {
      setDeleteError(error?.message || "Errore durante eliminazione progetto");
    } finally {
      deleteIdempotencyKeyRef.current = null;
      setDeleteLoading(false);
    }
  }, [tenant, deleteConfirmText, deleteLoading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="animate-spin size-6" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-10">
        <p className="text-muted-foreground">Progetto non trovato.</p>
        <Link href="/dashboard" className="mt-4 inline-flex items-center gap-2 text-sm text-primary-light hover:underline">
          <ArrowLeft size={14} /> Torna ai progetti
        </Link>
      </div>
    );
  }

  const deploymentUrl = tenant.vercel_url || "";
  const publicUrl = tenant.vercel_public_url || "";
  const billingStatus = billingSummary?.status ?? "unknown";
  const billingStatusLabel =
    billingStatus === "active" ? "Active" : billingStatus === "past_due" ? "Past Due" : "Unknown";
  const billingStatusClass =
    billingStatus === "active"
      ? "border-success-border bg-success text-success-foreground"
      : billingStatus === "past_due"
        ? "border-warning-border bg-warning text-warning-foreground"
        : "border-border bg-elevated text-muted-foreground";

  return (
    <div className="mx-auto max-w-screen-xl px-5 py-10">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} /> Projects
        </Link>
        <span className="text-border-strong">/</span>
        <h1 className="text-xl font-display truncate">{tenant.name}</h1>
        
      </div>

      <nav className="flex gap-1 border-b border-border mb-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors ${
              activeTab === t.id
                ? "bg-elevated text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-elevated"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-lg font-semibold mb-2">{tenant.name}</h2>
            <p className="text-sm text-muted-foreground font-mono">
              {publicUrl || deploymentUrl || "URL non disponibile"}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <GitBranch size={14} /> Repository
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`https://github.com/${tenant.github_owner_login}/${tenant.github_repo_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-primary-light hover:underline truncate"
                >
                  {tenant.github_owner_login}/{tenant.github_repo_name}
                </a>
                <CopyButton text={`${tenant.github_owner_login}/${tenant.github_repo_name}`} size={14} />
              </div>
            </div>
            <div className="border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Globe size={14} /> Public URL
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {publicUrl ? (
                  <>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-primary-light hover:underline truncate"
                    >
                      {publicUrl}
                    </a>
                    <CopyButton text={publicUrl} size={14} />
                  </>
                ) : (
                  <span className="font-mono text-sm text-muted-foreground truncate">Public URL non disponibile</span>
                )}
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 sm:col-span-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Globe size={14} /> Deployment URL
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {deploymentUrl ? (
                  <>
                    <a
                      href={deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-primary-light hover:underline truncate"
                    >
                      {deploymentUrl}
                    </a>
                    <CopyButton text={deploymentUrl} size={14} />
                  </>
                ) : (
                  <span className="font-mono text-sm text-muted-foreground truncate">
                    Deployment URL non disponibile
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-success-indicator" />
            Status: {tenant.status || "active"}
          </div>
          <div className="pt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={runHotSaveSnapshot}
              disabled={snapshotRunning || coldSaveRunning}
              className="gap-2"
            >
              {snapshotRunning ? <Loader2 className="size-4 animate-spin" /> : <Database size={15} />}
              HotSave Snapshot
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runColdSave}
              disabled={
                coldSaveRunning ||
                snapshotRunning ||
                !tenant.github_installation_id ||
                !tenant.vercel_project_id
              }
              className="gap-2"
              title={
                !tenant.github_installation_id || !tenant.vercel_project_id
                  ? "Richiede repository GitHub e progetto Vercel collegati"
                  : "Scrive il content store Supabase su Git e avvia deploy production"
              }
            >
              {coldSaveRunning ? <Loader2 className="size-4 animate-spin" /> : <GitBranch size={15} />}
              Cold save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!tenant.admin_private_key || !publicUrl || adminAccessLoading}
              title={
                !tenant.admin_private_key
                  ? "Admin keypair not configured — generate it in Settings"
                  : !publicUrl
                    ? "Public URL not available"
                    : "Open tenant Studio"
              }
              className="gap-2"
              onClick={async () => {
                if (!tenant.admin_private_key || !publicUrl) return;
                setAdminAccessLoading(true);
                setAdminAccessError(null);
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session?.access_token) throw new Error("Sessione assente o scaduta");
                  const res = await fetch(`/api/v1/tenants/${tenant.id}/admin-token`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${session.access_token}`,
                      "X-Correlation-Id": crypto.randomUUID(),
                    },
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                  window.open(`${data.adminUrl}?token=${data.token}`, "_blank");
                } catch (error: unknown) {
                  setAdminAccessError(error instanceof Error ? error.message : "Errore accesso admin");
                } finally {
                  setAdminAccessLoading(false);
                }
              }}
            >
              {adminAccessLoading ? <Loader2 className="size-4 animate-spin" /> : <Lock size={15} />}
              Admin
            </Button>
            {adminAccessError && (
              <p className="text-xs text-destructive-foreground">{adminAccessError}</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "domains" && (
        <DomainsPanel tenantId={tenant.id} />
      )}

      {activeTab === "leads" && (
        <LeadsPanel tenantId={tenant.id} />
      )}

      {activeTab === "agents" && (
        <AgentsPanel tenantId={tenant.id} tenantSlug={tenant.slug} />
      )}

      {activeTab === "billing" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <Card className="border border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Subscription</CardTitle>
              <CardDescription>
                Your Subscrition is managed via Lemon Squeezy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {billingLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading subscription...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-md border border-border bg-elevated p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Piano attivo</p>
                      <p className="text-sm font-semibold text-foreground">
                        {billingSummary?.planCode ? billingSummary.planCode.toUpperCase() : "N/A"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-elevated p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stato</p>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${billingStatusClass}`}>
                        {billingStatusLabel}
                      </span>
                    </div>
                    <div className="rounded-md border border-border bg-elevated p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Entitlement disponibili</p>
                      <p className="text-sm font-semibold text-foreground">{billingSummary?.entitlementCount ?? 0}</p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-elevated p-3 text-sm text-muted-foreground">
                    <p>
                      Renewal / Period End:{" "}
                      <span className="font-medium text-foreground">
                        {billingSummary?.renewalAt
                          ? new Date(billingSummary.renewalAt).toLocaleString()
                          : billingSummary?.currentPeriodEnd
                            ? new Date(billingSummary.currentPeriodEnd).toLocaleString()
                            : "Non disponibile"}
                      </span>
                    </p>
                  </div>
                </>
              )}

              {billingError && (
                <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
                  {billingError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="default"
                  onClick={handleManageBilling}
                  disabled={billingLoading || billingPortalLoading || !billingSummary?.canManageBilling}
                >
                  {billingPortalLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard size={15} />}
                  Manage Billing
                </Button>
                <Button type="button" variant="outline" onClick={loadBillingSummary} disabled={billingLoading}>
                  Refresh
                </Button>
              </div>
              {!billingSummary?.canManageBilling && !billingLoading && (
                <p className="text-xs text-muted-foreground">
                  Portal non ancora disponibile: completa almeno una subscription confermata per associare il customer.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <Card className="border border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock size={16} /> Admin Access
              </CardTitle>
              <CardDescription>
                EC P-256 keypair per accedere allo Studio dal platform. La chiave privata
                è memorizzata su Supabase e non lascia mai il server. Dopo la generazione,
                copia la chiave pubblica come env var{" "}
                <code className="font-mono text-xs">ADMIN_PUBLIC_KEY</code> sul progetto Vercel
                del tenant e rideploya.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  tenant.admin_private_key
                    ? "border-success-border bg-success text-success-foreground"
                    : "border-border bg-elevated text-muted-foreground"
                }`}>
                  {tenant.admin_private_key ? "Keypair configured" : "Not configured"}
                </span>
              </div>

              {!tenant.admin_private_key && !generatedPublicKey && (
                <div className="rounded-md border border-warning-border bg-warning/20 p-3 text-sm text-warning-foreground">
                  Keypair non configurato — il bottone Admin in Overview sarà disabilitato.
                </div>
              )}

              {generatedPublicKey && (
                <div className="space-y-2">
                  <div className="rounded-md border border-success-border bg-success/10 p-3 text-sm text-success-foreground">
                    Keypair generato. Copia la public key qui sotto, incollala come{" "}
                    <code className="font-mono text-xs">ADMIN_PUBLIC_KEY</code> su Vercel e rideploya il tenant.
                  </div>
                  <div className="relative">
                    <textarea
                      readOnly
                      value={generatedPublicKey}
                      rows={6}
                      className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-xs text-foreground font-mono resize-none outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(generatedPublicKey)}
                      className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Copia public key"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              )}

              {keypairError && (
                <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
                  {keypairError}
                </div>
              )}

              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGenerateKeypair}
                  disabled={generatingKeypair}
                  className="gap-2"
                >
                  {generatingKeypair ? <Loader2 className="size-4 animate-spin" /> : <Lock size={15} />}
                  {tenant.admin_private_key ? "Regenerate Keypair" : "Generate Keypair"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-destructive-border bg-destructive/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-destructive-foreground">Danger Zone</CardTitle>
              <CardDescription className="text-destructive-foreground/80">
                Elimina definitivamente il progetto, i riferimenti nel database e le immagini su storage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-destructive-border bg-destructive/30 p-3 text-sm text-destructive-foreground/90">
                Questa azione e irreversibile. Per confermare, scrivi lo slug del progetto:
                <span className="ml-1 font-mono font-semibold">{tenant.slug}</span>
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-delete-input" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Conferma slug progetto
                </label>
                <input
                  id="confirm-delete-input"
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  placeholder={tenant.slug}
                  className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-destructive-ring"
                  autoComplete="off"
                />
              </div>
              {deleteError ? (
                <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
                  {deleteError}
                </div>
              ) : null}
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive-border text-destructive-foreground hover:bg-destructive/40 hover:text-destructive-foreground"
                  onClick={handleDeleteProject}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  {deleteLoading ? "Deleting..." : "Delete project"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {coldSaveOpen && (
        <div className="fixed inset-0 z-50 bg-overlay/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold">Cold save</h3>
                <p className="text-xs text-muted-foreground">Supabase content store → GitHub → deploy production.</p>
              </div>
              <button
                type="button"
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!coldSaveRunning) setColdSaveOpen(false);
                }}
                disabled={coldSaveRunning}
                title="Chiudi"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {coldSaveSteps.map((step) => (
                  <div key={step.id} className="rounded-md border border-border bg-elevated p-2 text-xs">
                    <div className="font-medium text-foreground">{step.label}</div>
                    <div className="text-muted-foreground mt-1">
                      {step.status === "idle" ? "idle" : step.status === "running" ? "running..." : step.status}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border bg-elevated p-3 h-40 overflow-auto text-xs font-mono text-muted-foreground space-y-1">
                {coldSaveLogs.length === 0 ? <div className="text-muted-foreground">Nessun log disponibile.</div> : null}
                {coldSaveLogs.map((log, idx) => (
                  <div key={`${idx}-${log.slice(0, 16)}`}>{log}</div>
                ))}
              </div>

              {coldSaveResult && !coldSaveError ? (
                <div className="rounded-md border border-emerald-700/60 bg-emerald-900/20 p-3 text-sm text-emerald-200">
                  Done. files={coldSaveResult.filesWritten}
                  {coldSaveResult.commitSha ? `, commit=${coldSaveResult.commitSha.slice(0, 7)}` : ""}
                  {coldSaveResult.deployUrl ? (
                    <>
                      ,{" "}
                      <a href={coldSaveResult.deployUrl} className="underline" target="_blank" rel="noreferrer">
                        live URL
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}

              {coldSaveError ? (
                <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
                  {coldSaveError}
                  {coldSaveCorrelationId ? <div className="mt-1 text-xs">Correlation: {coldSaveCorrelationId}</div> : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {coldSaveCorrelationId ? `Correlation: ${coldSaveCorrelationId}` : "Correlation: pending"}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setColdSaveOpen(false)}
                    disabled={coldSaveRunning}
                  >
                    Chiudi
                  </Button>
                  <Button type="button" onClick={runColdSave} disabled={coldSaveRunning}>
                    {coldSaveRunning ? <Loader2 className="size-4 animate-spin" /> : null}
                    {coldSaveRunning ? "Running..." : "Run again"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {snapshotOpen && (
        <div className="fixed inset-0 z-50 bg-overlay/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold">HotSave Snapshot</h3>
                <p className="text-xs text-muted-foreground">Snapshot repository JSON → Supabase content store.</p>
              </div>
              <button
                type="button"
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!snapshotRunning) setSnapshotOpen(false);
                }}
                disabled={snapshotRunning}
                title="Chiudi"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {snapshotSteps.map((step) => (
                  <div key={step.id} className="rounded-md border border-border bg-elevated p-2 text-xs">
                    <div className="font-medium text-foreground">{step.label}</div>
                    <div className="text-muted-foreground mt-1">
                      {step.status === "idle" ? "idle" : step.status === "running" ? "running..." : step.status}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border bg-elevated p-3 h-40 overflow-auto text-xs font-mono text-muted-foreground space-y-1">
                {snapshotLogs.length === 0 ? <div className="text-muted-foreground">Nessun log disponibile.</div> : null}
                {snapshotLogs.map((log, idx) => (
                  <div key={`${idx}-${log.slice(0, 16)}`}>{log}</div>
                ))}
              </div>

              {snapshotResult && !snapshotError ? (
                <div className="rounded-md border border-emerald-700/60 bg-emerald-900/20 p-3 text-sm text-emerald-200">
                  Done. entities={snapshotResult.entitiesWritten}, pages={snapshotResult.pagesWritten}, config={snapshotResult.configWritten}
                </div>
              ) : null}

              {snapshotError ? (
                <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
                  {snapshotError}
                  {snapshotCorrelationId ? <div className="mt-1 text-xs">Correlation: {snapshotCorrelationId}</div> : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {snapshotCorrelationId ? `Correlation: ${snapshotCorrelationId}` : "Correlation: pending"}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSnapshotOpen(false)}
                    disabled={snapshotRunning}
                  >
                    Chiudi
                  </Button>
                  <Button type="button" onClick={runHotSaveSnapshot} disabled={snapshotRunning}>
                    {snapshotRunning ? <Loader2 className="size-4 animate-spin" /> : null}
                    {snapshotRunning ? "Running..." : "Run again"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
