"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  Github,
  Check,
  Loader2,
  ArrowLeft,
  Zap,
  X,
  Rocket,
  Globe,
  ExternalLink,
  Cpu,
  Package,
  Terminal,
  RefreshCw,
  AlertCircle,
  Search,
} from "lucide-react";

const STREAM_STEPS = [
  { id: "repo", icon: Github, label: "Creazione repository", sublabel: "GitHub API" },
  { id: "vercel", icon: Cpu, label: "Progetto Vercel", sublabel: "Vercel API" },
  { id: "env", icon: Package, label: "Variabili ENV", sublabel: "Vercel API" },
  { id: "deploy", icon: Terminal, label: "Attesa deploy", sublabel: "Vercel" },
  { id: "db", icon: Rocket, label: "Salvataggio tenant", sublabel: "Supabase" },
];

const IMPORT_STEPS = [
  { id: "repo", icon: Github, label: "Collegamento repository", sublabel: "GitHub" },
  { id: "vercel", icon: Cpu, label: "Progetto Vercel", sublabel: "Vercel API" },
  { id: "env", icon: Package, label: "Variabili ENV", sublabel: "Vercel API" },
  { id: "deploy", icon: Terminal, label: "Attesa deploy", sublabel: "Vercel" },
  { id: "db", icon: Rocket, label: "Salvataggio tenant", sublabel: "Supabase" },
];

interface Installation {
  id: number;
  account?: { login?: string; type?: string; avatar_url?: string };
}

interface Template {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  homepage: string;
  previewUrl: string;
}

interface CreateTenantFlowProps {
  onClose: () => void;
  onComplete: (tenant: { id: string; name: string; slug: string; api_key?: string }) => void;
  onCreateNowFromDecision?: () => void;
  onCreateLater?: () => void;
  onEntitlementConflict?: () => void | Promise<void>;
  entitlementDecisionMode?: boolean;
  entitlementCorrelationId?: string | null;
  entitlementPlanCode?: "starter" | "pro" | "business" | null;
  entitlementUpdatedAt?: string | null;
  initialInstallationId?: string | null;
  installUrl?: string | null;
  configureUrl?: string | null;
  installations?: Installation[];
  installationsError?: string | null;
  loadInstallations: () => Promise<void>;
  /** When true, render only the step content (no fullscreen overlay). Used when the flow is embedded inside the purchase overlay. */
  embedded?: boolean;
}

function StepGitHub({
  onNext,
  onClose,
  installations,
  installationsError,
  installUrl,
  loadInstallations,
}: {
  onNext: (data: { installationId: string; ownerLogin: string; accountType?: string }) => void;
  onClose: () => void;
  installations: Installation[];
  installationsError: string | null;
  installUrl: string | null;
  loadInstallations: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<{ id: string; login: string; type?: string } | null>(null);

  return (
    <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Step 1 di 2</p>
            <h2 className="text-lg font-semibold">Connetti GitHub</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-elevated">
            <X size={18} />
          </button>
        </div>
        <div className="h-1 bg-border rounded-full mb-6">
          <div className="h-full w-1/3 bg-primary rounded-full transition-all" />
        </div>
        <p className="text-sm text-muted-foreground mb-4">Seleziona l&apos;installazione GitHub da usare.</p>

        {installationsError && (
          <div className="mb-4 p-3 rounded-lg bg-warning/20 border border-warning-border flex items-center justify-between gap-2">
            <span className="text-sm text-warning-foreground">{installationsError}</span>
            <button type="button" onClick={loadInstallations} className="text-xs px-2 py-1 rounded bg-warning/30 hover:bg-warning/50 text-warning-foreground">
              Riprova
            </button>
          </div>
        )}

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {installations.map((inst) => (
            <button
              key={inst.id}
              type="button"
              onClick={() => setSelected({ id: String(inst.id), login: inst.account?.login || "", type: inst.account?.type })}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                selected?.id === String(inst.id)
                  ? "border-primary bg-primary/10"
                  : "border-border bg-elevated hover:border-border-strong"
              }`}
            >
              {inst.account?.avatar_url ? (
                <img src={inst.account.avatar_url} alt="" className="w-9 h-9 rounded-full" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-border-strong flex items-center justify-center text-sm font-medium">
                  {inst.account?.login?.charAt(0) || "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{inst.account?.login || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{inst.account?.type === "Organization" ? "Organizzazione" : "Account"}</p>
              </div>
              {selected?.id === String(inst.id) && <Check size={16} className="text-primary-light shrink-0" />}
            </button>
          ))}
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 bg-card text-xs text-muted-foreground">oppure</span>
          </div>
        </div>

        {installUrl && (
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-strong hover:border-primary/50 hover:bg-elevated transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center">
              <Github size={18} className="text-muted-foreground" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">Installa su un altro account</p>
              <p className="text-xs text-muted-foreground">Aggiungi l&apos;app a un nuovo account o org</p>
            </div>
            <ExternalLink size={14} className="text-muted-foreground" />
          </a>
        )}

        <div className="flex gap-2 mt-6 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground">
            Annulla
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onNext({ installationId: selected.id, ownerLogin: selected.login, accountType: selected.type })}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            Continua <ArrowLeft size={14} className="rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StepRepo({
  onNext,
  onBack,
  onClose,
  installationId,
  ownerLogin,
  repos,
  loadingRepos,
  error,
}: {
  onNext: (data: {
    mode: "import" | "create";
    tenantName: string;
    slug: string;
    repo?: { id: string; name: string; full_name?: string };
    templateRepo?: { owner: string; repo: string };
  }) => void;
  onBack: () => void;
  onClose: () => void;
  installationId: string;
  ownerLogin: string;
  repos: { id: string; name: string; full_name?: string; private?: boolean }[];
  loadingRepos: boolean;
  error: string | null;
}) {
  const [mode, setMode] = useState<"import" | "create">("import");
  const [selectedRepo, setSelectedRepo] = useState<{ id: string; name: string; full_name?: string } | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [repoSearch, setRepoSearch] = useState("");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templatesReloadKey, setTemplatesReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    fetch("/api/v1/templates")
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: { templates?: Template[] }) => {
        if (cancelled) return;
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplatesError(e instanceof Error ? e.message : "Errore");
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templatesReloadKey]);

  const slug = mode === "create" ? createSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") : (selectedRepo?.name || tenantName).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const displayName = mode === "import" ? (tenantName || selectedRepo?.name || "") : (slug || createSlug || "");
  const canProceed = mode === "import"
    ? selectedRepo && displayName.length > 0
    : selectedTemplate !== null && createSlug.trim().length > 0;

  return (
    <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-elevated">
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Step 2 di 2</p>
              <h2 className="text-lg font-semibold">Configura tenant</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-elevated">
            <X size={18} />
          </button>
        </div>
        <div className="h-1 bg-border rounded-full mb-6">
          <div className="h-full w-2/3 bg-primary rounded-full transition-all" />
        </div>

        <div className="flex rounded-lg bg-elevated p-0.5 gap-0.5 mb-4">
          {(["import", "create"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                mode === m ? "bg-overlay text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "import" ? "Da repository esistente" : "Da template"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/20 border border-destructive-border flex items-center gap-2 text-destructive-foreground text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {mode === "import" && (
          <>
            <p className="text-xs text-muted-foreground mb-2">Repository</p>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Cerca per nome..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-elevated border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 mb-4">
              {loadingRepos ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (() => {
                const q = repoSearch.trim().toLowerCase();
                const filtered = q
                  ? repos.filter(
                      (r) =>
                        (r.name && r.name.toLowerCase().includes(q)) ||
                        (r.full_name && r.full_name.toLowerCase().includes(q))
                    )
                  : repos;
                if (filtered.length === 0) {
                  return (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {repos.length === 0 ? "Nessun repository." : `Nessun risultato per "${repoSearch.trim()}".`}
                    </p>
                  );
                }
                return filtered.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => {
                      setSelectedRepo({ id: repo.id, name: repo.name, full_name: repo.full_name });
                      if (!tenantName) setTenantName(repo.name);
                    }}
                    className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm ${
                      selectedRepo?.id === repo.id ? "border-primary bg-primary/10" : "border-border bg-elevated hover:border-border-strong"
                    }`}
                  >
                    <Github size={14} className="text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{repo.name}</span>
                    {selectedRepo?.id === repo.id && <Check size={14} className="text-primary-light ml-auto shrink-0" />}
                  </button>
                ));
              })()}
            </div>
          </>
        )}

        {mode === "create" && (
          <>
            <p className="text-xs text-muted-foreground mb-2">Scegli un template OlonJS</p>
            <div className="mb-4 max-h-72 overflow-y-auto">
              {templatesLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-lg border border-border bg-elevated overflow-hidden">
                      <div className="aspect-[16/9] bg-border animate-pulse" />
                      <div className="p-2.5 space-y-1.5">
                        <div className="h-3 w-2/3 bg-border rounded animate-pulse" />
                        <div className="h-2.5 w-full bg-border rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : templatesError ? (
                <div className="p-4 rounded-lg border border-destructive-border bg-destructive/10 text-sm text-destructive-foreground flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} />
                    <span>Impossibile caricare i template (GitHub non raggiungibile).</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTemplatesReloadKey((k) => k + 1)}
                    className="text-xs px-2 py-1 rounded bg-destructive/30 hover:bg-destructive/50 text-destructive-foreground"
                  >
                    Riprova
                  </button>
                </div>
              ) : templates.length === 0 ? (
                <div className="p-4 rounded-lg border border-border bg-elevated text-sm text-muted-foreground flex items-center justify-between gap-3">
                  <span>Nessun template disponibile. Riprova tra qualche minuto.</span>
                  <button
                    type="button"
                    onClick={() => setTemplatesReloadKey((k) => k + 1)}
                    className="text-xs px-2 py-1 rounded bg-elevated hover:bg-border text-foreground border border-border"
                  >
                    Riprova
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((t) => {
                    const isSelected = selectedTemplate?.repo === t.repo && selectedTemplate?.owner === t.owner;
                    return (
                      <button
                        key={`${t.owner}/${t.repo}`}
                        type="button"
                        onClick={() => setSelectedTemplate(t)}
                        className={`group text-left rounded-lg border overflow-hidden transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-elevated hover:border-border-strong"
                        }`}
                      >
                        <div className="relative aspect-[16/9] bg-border overflow-hidden">
                          {t.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.previewUrl}
                              alt={`${t.repo} preview`}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : null}
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                              <Check size={12} />
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold truncate">{t.repo}</span>
                            {t.homepage ? (
                              <a
                                href={t.homepage}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-primary-light hover:underline"
                              >
                                Vedi demo <ExternalLink size={10} />
                              </a>
                            ) : null}
                          </div>
                          {t.description ? (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="mb-4">
              <label className="block text-xs text-muted-foreground mb-1">Nome repo</label>
              <input
                type="text"
                placeholder="my-site"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">Verrà creato: <span className="font-mono text-foreground">{ownerLogin}/{slug || "…"}</span></p>
            </div>
          </>
        )}

        {mode === "import" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Nome tenant</label>
            <input
              type="text"
              placeholder="Il mio sito"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
            {displayName && <p className="mt-1 text-xs text-muted-foreground">Nome desiderato: <span className="font-mono text-foreground">{slug || "…"}</span></p>}
            <p className="mt-1 text-xs text-muted-foreground">L&apos;URL finale è confermato da Vercel dopo il provisioning.</p>
          </div>
        )}

        <div className="flex gap-2 mt-6 justify-end">
          <button type="button" onClick={onBack} className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground">
            Indietro
          </button>
          <button
            type="button"
            disabled={!canProceed}
            onClick={() => {
              if (mode === "import" && selectedRepo) {
                onNext({ mode: "import", tenantName: displayName, slug, repo: selectedRepo });
              } else if (selectedTemplate) {
                onNext({
                  mode: "create",
                  tenantName: displayName || createSlug,
                  slug,
                  templateRepo: { owner: selectedTemplate.owner, repo: selectedTemplate.repo },
                });
              }
            }}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            Provisiona tenant <Zap size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function parseSSE(buffer: string): { event: string; data: string }[] {
  const lines = buffer.split("\n");
  const out: { event: string; data: string }[] = [];
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
    else if (line === "" && data) {
      out.push({ event, data });
      data = "";
      event = "message";
    }
  }
  if (data) out.push({ event, data });
  return out;
}

type StreamTerminalState = "running" | "succeeded" | "failed";

function DopaComponent({
  tenantName,
  slug,
  mode,
  onComplete,
  onError,
  flowData,
  onRetry,
  onCreateNow,
  onCreateLater,
  onEntitlementConflict,
  entitlementCorrelationId,
  entitlementPlanCode,
  entitlementUpdatedAt,
}: {
  tenantName: string;
  slug: string;
  mode: "import" | "create" | "decision";
  onComplete: (tenant: { id: string; name: string; slug: string; api_key?: string }) => void;
  onError: (message: string) => void;
  flowData: {
    installationId?: string;
    ownerLogin?: string;
    accountType?: string;
    repo?: { id: string; name: string; full_name?: string };
    templateRepo?: { owner: string; repo: string };
  };
  onRetry?: () => void;
  onCreateNow?: () => void;
  onCreateLater?: () => void;
  onEntitlementConflict?: () => void | Promise<void>;
  entitlementCorrelationId?: string | null;
  entitlementPlanCode?: "starter" | "pro" | "business" | null;
  entitlementUpdatedAt?: string | null;
}) {
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{
    tenant: { id: string; name: string; slug: string };
    api_key?: string;
    deployUrl?: string;
  } | null>(null);
  const [progressCircle, setProgressCircle] = useState(0);
  const steps = mode === "create" ? STREAM_STEPS : IMPORT_STEPS; // import usa gli stessi step (repo + vercel + env + deploy + db)

  const addLog = useCallback((stepId: string, message: string) => {
    setLogs((prev) => ({ ...prev, [stepId]: [...(prev[stepId] || []), message] }));
  }, []);

  const applyParsedEvent = useCallback(
    (
      ev: string,
      raw: string,
      markDone: () => void,
      markFailed: () => void,
      stopWithError: (message: string, code?: string | null) => void
    ) => {
      try {
        const data = JSON.parse(raw);
        if (ev === "step") {
          if (data.status === "running" && data.id) setActiveStepId(data.id);
          if (data.status === "done" && data.id) {
            setCompletedSteps((prev) => [...prev, data.id].filter(Boolean));
            setActiveStepId(null);
          }
        } else if (ev === "log" && data.stepId && data.message) {
          addLog(data.stepId, data.message);
        } else if (ev === "error") {
          markFailed();
          if (data.stepId && data.message) {
            addLog(data.stepId, `Errore: ${data.message}`);
          }
          stopWithError(data.message || "Errore", data.code ?? null);
        } else if (ev === "done") {
          markDone();
          setCompletedSteps((prev) => [...prev, "db"]);
          setActiveStepId(null);
          setCompletedResult({
            tenant: data.tenant,
            api_key: data.api_key,
            deployUrl: data.deployUrl,
          });
          setDone(true);
        }
      } catch {
        // ignore parse errors
      }
    },
    [addLog]
  );

  useEffect(() => {
    if (mode === "decision") return;

    if (mode === "import" && flowData.repo) {
      let cancelled = false;
      let terminalState: StreamTerminalState = "running";
      const runStream = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setActiveStepId("repo");
        setCompletedSteps([]);
        setLogs({});
        setError(null);
        setErrorCode(null);
        try {
          const res = await fetch("/api/v1/tenants/provision-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              installationId: flowData.installationId,
              userId: user.id,
              entitlementCorrelationId,
              entitlementPlanCode,
              source: {
                type: "repository",
                repo: flowData.repo,
                ownerLogin: flowData.ownerLogin,
              },
            }),
          });
          if (!res.ok || !res.body) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || data.message || `HTTP ${res.status}`);
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          const stopWithError = (message: string, code?: string | null) => {
            terminalState = "failed";
            setError(message);
            setErrorCode(code ?? null);
            onError(message);
          };
          const markDone = () => {
            terminalState = "succeeded";
          };
          const markFailed = () => {
            terminalState = "failed";
          };
          while (true) {
            const { value, done: streamDone } = await reader.read();
            if (cancelled) break;
            if (value) buffer += dec.decode(value, { stream: true });
            if (streamDone) {
              buffer += dec.decode();
            }
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const parsed = parseSSE(part + "\n\n");
              for (const { event: ev, data: raw } of parsed) {
                applyParsedEvent(ev, raw, markDone, markFailed, stopWithError);
                if (terminalState !== "running" || cancelled) break;
              }
              if (terminalState !== "running" || cancelled) break;
            }
            if (terminalState !== "running" || cancelled || streamDone) break;
          }
          if (!cancelled && terminalState === "running") {
            const fallback = "Operazione interrotta: stream terminato senza evento finale.";
            setError(fallback);
            setErrorCode("ERR_PROVISION_STREAM_TERMINATED");
            onError(fallback);
          }
        } catch (e) {
          if (!cancelled) {
            const msg = e instanceof Error ? e.message : "Errore";
            setError(msg);
            setErrorCode("ERR_PROVISION_STREAM_CLIENT");
            onError(msg);
          }
        }
      };
      runStream();
      return () => {
        cancelled = true;
      };
    }

    if (mode !== "create") return;

    let cancelled = false;
    let terminalState: StreamTerminalState = "running";
    const runStream = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setActiveStepId("repo");
      setCompletedSteps([]);
      setLogs({});
      setError(null);
      setErrorCode(null);
      try {
        const res = await fetch("/api/v1/tenants/provision-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId: flowData.installationId,
            userId: user.id,
            entitlementCorrelationId,
            entitlementPlanCode,
            source: {
              type: "template",
              slug,
              ownerLogin: flowData.ownerLogin,
              accountType: flowData.accountType,
              templateRepo: flowData.templateRepo,
            },
          }),
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buffer = "";
        const stopWithError = (message: string, code?: string | null) => {
          terminalState = "failed";
          setError(message);
          setErrorCode(code ?? null);
          onError(message);
        };
        const markDone = () => {
          terminalState = "succeeded";
        };
        const markFailed = () => {
          terminalState = "failed";
        };
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (cancelled) break;
          if (value) buffer += dec.decode(value, { stream: true });
          if (streamDone) {
            buffer += dec.decode();
          }
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const parsed = parseSSE(part + "\n\n");
            for (const { event: ev, data: raw } of parsed) {
              applyParsedEvent(ev, raw, markDone, markFailed, stopWithError);
              if (terminalState !== "running" || cancelled) break;
            }
            if (terminalState !== "running" || cancelled) break;
          }
          if (terminalState !== "running" || cancelled || streamDone) break;
        }
        if (!cancelled && terminalState === "running") {
          const fallback = "Operazione interrotta: stream terminato senza evento finale.";
          setError(fallback);
          setErrorCode("ERR_PROVISION_STREAM_TERMINATED");
          onError(fallback);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Errore";
          setError(msg);
          setErrorCode("ERR_PROVISION_STREAM_CLIENT");
          onError(msg);
        }
      }
    };
    runStream();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    slug,
    flowData.installationId,
    flowData.ownerLogin,
    flowData.accountType,
    flowData.repo,
    flowData.templateRepo,
    addLog,
    applyParsedEvent,
    onError,
    entitlementCorrelationId,
    entitlementPlanCode,
  ]);

  useEffect(() => {
    if (!done || !completedResult) return;
    const duration = 5000;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      setProgressCircle(Math.min(100, (elapsed / duration) * 100));
      if (elapsed < duration) requestAnimationFrame(tick);
      else onComplete({ ...completedResult.tenant, api_key: completedResult.api_key });
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [done, completedResult, onComplete]);

  const totalSteps = steps.length;
  const progressPct = done ? 100 : totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0;

  if (mode === "decision") {
    const updatedLabel = entitlementUpdatedAt ? new Date(entitlementUpdatedAt).toLocaleString() : null;
    return (
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl p-6">
        <h2 className="text-lg font-semibold mb-2">Pagamento confermato</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Decidi ora se creare subito il tenant oppure rimandare e riprendere dalla dashboard.
        </p>
        <div className="mb-5 p-3 rounded-lg border border-border bg-elevated text-xs text-foreground space-y-1">
          <p>Entitlement selezionato (FIFO)</p>
          <p>Plan: <span className="font-mono">{entitlementPlanCode ?? "n/a"}</span></p>
          <p>Updated: <span className="font-mono">{updatedLabel ?? "n/a"}</span></p>
          <p>Correlation: <span className="font-mono">{entitlementCorrelationId ? `${entitlementCorrelationId.slice(0, 8)}...` : "n/a"}</span></p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCreateLater}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground"
          >
            Lo faccio dopo
          </button>
          <button
            type="button"
            onClick={onCreateNow}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            Crea tenant ora
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl p-6">
        <div className="flex items-center gap-2 text-destructive-foreground mb-4">
          <AlertCircle size={20} /> <span className="font-semibold">Errore</span>
        </div>
        <p className="text-sm text-foreground mb-4">{error}</p>
        {errorCode && <p className="text-xs text-destructive-foreground font-mono mb-4">code: {errorCode}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onComplete({ id: "", name: tenantName, slug })}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground"
          >
            Chiudi
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={async () => {
                setError(null);
                if (errorCode === "ERR_ENTITLEMENT_CONSUME_CONFLICT" && onEntitlementConflict) {
                  await onEntitlementConflict();
                  return;
                }
                onRetry?.();
              }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
            >
              Riprova
            </button>
          )}
        </div>
      </div>
    );
  }

  if (done && completedResult) {
    const url = completedResult.deployUrl;
    return (
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl p-8 text-center">
        <div className="relative inline-flex items-center justify-center mb-6">
          <svg className="size-20 -rotate-90" viewBox="0 0 36 36">
            <path
              className="text-border-strong"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="text-success-indicator transition-all duration-150"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={`${(progressCircle / 100) * 100} 100`}
              fill="none"
              strokeLinecap="round"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-success/20 border-2 border-success-indicator flex items-center justify-center">
              <Rocket size={22} className="text-success-indicator" />
            </div>
          </div>
        </div>
        <h2 className="text-xl font-bold mb-2">Tenant live!</h2>
        <p className="text-sm text-muted-foreground mb-4">Reindirizzamento alla scheda progetto...</p>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-elevated border border-border text-left">
          <Globe size={16} className="text-success-indicator shrink-0" />
          {url ? (
            <>
              <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-primary-light truncate flex-1 hover:underline">
                {url}
              </a>
              <ExternalLink size={14} className="text-muted-foreground shrink-0" />
            </>
          ) : (
            <span className="font-mono text-sm text-muted-foreground truncate flex-1">URL non disponibile</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Provisioning in corso</h2>
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-elevated text-muted-foreground">{progressPct}%</span>
      </div>
      <div className="h-1.5 bg-border rounded-full mb-6">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="space-y-0">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.includes(step.id);
          const isActive = activeStepId === step.id;
          const stepLogs = logs[step.id] || [];
          return (
            <div key={step.id} className="flex gap-4 py-2">
              <div className="flex flex-col items-center shrink-0 w-7">
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                    isCompleted ? "bg-success/20 border-success-indicator" : isActive ? "bg-primary/20 border-primary" : "bg-elevated border-border-strong"
                  }`}
                >
                  {isCompleted ? <Check size={12} className="text-success-indicator" /> : isActive ? <Loader2 size={12} className="animate-spin text-primary-light" /> : <step.icon size={12} className="text-muted-foreground" />}
                </div>
                {idx < steps.length - 1 && <div className={`w-0.5 flex-1 min-h-4 mt-1 ${isCompleted ? "bg-success-indicator" : "bg-border"}`} />}
              </div>
              <div className="flex-1 min-w-0 pb-3">
                <p className={`text-sm font-medium ${isCompleted || isActive ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.sublabel}</p>
                {stepLogs.length > 0 && (
                  <div className="mt-2 h-10 overflow-y-auto p-2 rounded bg-elevated border border-border font-mono text-xs text-muted-foreground space-y-0.5">
                    {stepLogs.map((line, i) => (
                      <div key={i}>$ {line}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-elevated text-muted-foreground text-sm">
        <RefreshCw size={14} className="animate-spin shrink-0" />
        Operazione in corso — non chiudere
      </div>
    </div>
  );
}

export function CreateTenantFlow({
  onClose,
  onComplete,
  onCreateNowFromDecision,
  onCreateLater,
  onEntitlementConflict,
  entitlementDecisionMode,
  entitlementCorrelationId,
  entitlementPlanCode,
  entitlementUpdatedAt,
  initialInstallationId,
  installUrl,
  configureUrl,
  installations = [],
  installationsError,
  loadInstallations,
  embedded = false,
}: CreateTenantFlowProps) {
  const [latchedEntitlement, setLatchedEntitlement] = useState<{
    correlationId: string | null;
    planCode: "starter" | "pro" | "business" | null;
    updatedAt: string | null;
  }>({
    correlationId: entitlementCorrelationId ?? null,
    planCode: entitlementPlanCode ?? null,
    updatedAt: entitlementUpdatedAt ?? null,
  });
  const [isDecisionActive, setIsDecisionActive] = useState(Boolean(entitlementDecisionMode));
  const [flowStep, setFlowStep] = useState<"github" | "repo" | "provisioning">(
    entitlementDecisionMode ? "provisioning" : initialInstallationId ? "repo" : "github"
  );
  const [flowData, setFlowData] = useState<{
    installationId?: string;
    ownerLogin?: string;
    accountType?: string;
    tenantName?: string;
    slug?: string;
    mode?: "import" | "create";
    repo?: { id: string; name: string; full_name?: string };
    templateRepo?: { owner: string; repo: string };
  }>(() => (initialInstallationId ? { installationId: initialInstallationId } : {}));
  const [repos, setRepos] = useState<{ id: string; name: string; full_name?: string; private?: boolean }[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const installationId = flowData.installationId || initialInstallationId || null;
  const ownerLogin = flowData.ownerLogin ?? installations.find((i) => String(i.id) === installationId)?.account?.login ?? "";

  useEffect(() => {
    setLatchedEntitlement((prev) => ({
      correlationId: prev.correlationId ?? entitlementCorrelationId ?? null,
      planCode: prev.planCode ?? entitlementPlanCode ?? null,
      updatedAt: prev.updatedAt ?? entitlementUpdatedAt ?? null,
    }));
  }, [entitlementCorrelationId, entitlementPlanCode, entitlementUpdatedAt]);

  useEffect(() => {
    if (initialInstallationId && !flowData.installationId) {
      const inst = installations.find((i) => String(i.id) === initialInstallationId);
      setFlowData((d) => ({
        ...d,
        installationId: initialInstallationId,
        ownerLogin: inst?.account?.login ?? "",
        accountType: inst?.account?.type,
      }));
    }
  }, [initialInstallationId, installations, flowData.installationId]);

  useEffect(() => {
    if (flowStep !== "repo" || !installationId) return;
    setLoadingRepos(true);
    setError(null);
    fetch(`/api/v1/github/repos?installation_id=${installationId}`)
      .then((res) => res.json())
      .then((data) => {
        setRepos(data.repos || []);
        if (data.error) setError(data.error);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingRepos(false));
  }, [flowStep, installationId]);

  const handleComplete = (tenant: { id: string; name: string; slug: string; api_key?: string }) => {
    onClose();
    onComplete(tenant);
  };

  const stepContent = (
    <>
      {flowStep === "github" && (
        <StepGitHub
          onClose={onClose}
          onNext={(data) => {
            setFlowData((d) => ({ ...d, ...data }));
            setFlowStep("repo");
          }}
          installations={installations}
          installationsError={installationsError || null}
          installUrl={installUrl || null}
          loadInstallations={loadInstallations}
        />
      )}
      {flowStep === "repo" && (
        <StepRepo
          onBack={() => setFlowStep("github")}
          onClose={onClose}
          onNext={(data) => {
            setFlowData((d) => ({
              ...d,
              ...data,
              tenantName: data.tenantName,
              slug: data.slug,
              mode: data.mode,
              repo: data.repo,
              templateRepo: data.templateRepo,
            }));
            setFlowStep("provisioning");
          }}
          installationId={installationId!}
          ownerLogin={ownerLogin}
          repos={repos}
          loadingRepos={loadingRepos}
          error={error}
        />
      )}
      {flowStep === "provisioning" && (
        <DopaComponent
          key={retryKey}
          tenantName={flowData.tenantName || "my-site"}
          slug={flowData.slug || flowData.tenantName?.toLowerCase().replace(/\s+/g, "-") || "my-site"}
          mode={isDecisionActive && flowStep === "provisioning" ? "decision" : flowData.mode || "create"}
          onComplete={handleComplete}
          onError={setError}
          onRetry={() => setRetryKey((k) => k + 1)}
          onCreateNow={() => {
            setIsDecisionActive(false);
            onCreateNowFromDecision?.();
            // Hard requirement: "Create now" must always restart from Step 1 (GitHub).
            setFlowData({});
            setFlowStep("github");
          }}
          onCreateLater={() => {
            onCreateLater?.();
            onClose();
          }}
          onEntitlementConflict={onEntitlementConflict}
          entitlementCorrelationId={latchedEntitlement.correlationId}
          entitlementPlanCode={latchedEntitlement.planCode}
          entitlementUpdatedAt={latchedEntitlement.updatedAt}
          flowData={{
            installationId: flowData.installationId,
            ownerLogin: flowData.ownerLogin,
            accountType: flowData.accountType,
            repo: flowData.repo,
            templateRepo: flowData.templateRepo,
          }}
        />
      )}
    </>
  );

  if (embedded) {
    return stepContent;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/85 backdrop-blur-sm">
      {stepContent}
    </div>
  );
}
