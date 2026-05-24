"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  Package,
  Rocket,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

// ----------------------------------------------------------------------------
// CreateTenantModal (T-105)
//
// Single-owner 3-step wizard for provisioning a new tenant:
//   1. Pick template from the olonjs/* gallery (GET /api/v1/templates).
//   2. Choose name + slug — client-side regex validation for now; live
//      availability check (parallel GitHub + Vercel lookups) is a follow-up
//      under T-106 once the helper routes land.
//   3. Confirm → POST /api/v1/tenants/provision-stream (SSE, T-106) and
//      render step / log / done / error events.
//
// Stripped from the jsonpages-platform fork's CreateTenantFlow.tsx: the
// LemonSqueezy entitlement decision mode, the GitHub-installations picker
// (single-owner uses the buyer's olonjs installation seeded by T-A06), the
// import-existing-repo branch (templates only at day-1), the legacy provision
// dispatcher (deployment_target hardcoded to client_vercel, T-006).
// ----------------------------------------------------------------------------

export type CreateTenantModalProps = {
  onClose: () => void;
  onComplete: (tenant: { id: string; name?: string; slug: string }) => void;
};

type Template = {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  homepage: string;
  previewUrl: string;
};

type ProvisionEvent =
  | { type: "step"; id: string; label: string }
  | { type: "log"; message: string }
  | { type: "done"; tenant: { id: string; name?: string; slug: string } }
  | { type: "error"; message: string; code?: string };

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function deriveSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CreateTenantModal({ onClose, onComplete }: CreateTenantModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Step 2 state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  // Step 3 state (SSE)
  const [streaming, setStreaming] = useState(false);
  const [streamSteps, setStreamSteps] = useState<{ id: string; label: string }[]>([]);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // -------------------------------------------------------------------- Step 1
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/templates")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.error) {
          setTemplatesError(data.message ?? data.error);
          setTemplates([]);
          return;
        }
        setTemplates(Array.isArray(data?.templates) ? data.templates : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setTemplatesError(err instanceof Error ? err.message : "Failed to load templates");
        setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------- Step 2
  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(deriveSlugFromName(value));
  };
  const slugValid = SLUG_REGEX.test(slug);

  // -------------------------------------------------------------------- Step 3
  const startProvision = useCallback(async () => {
    if (!selectedTemplate || !slugValid) return;
    setStreaming(true);
    setStreamSteps([]);
    setStreamLogs([]);
    setStreamError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setStreamError("Session expired. Please reload and sign in again.");
        setStreaming(false);
        return;
      }
      const res = await fetch("/api/v1/tenants/provision-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          template: { owner: selectedTemplate.owner, repo: selectedTemplate.repo },
          slug,
          name: name || slug,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`provision-stream ${res.status}: ${body.slice(0, 200)}`);
      }

      // Parse SSE: data: <json>\n\n
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let event: ProvisionEvent;
          try {
            event = JSON.parse(dataLine.slice(5).trim()) as ProvisionEvent;
          } catch {
            continue;
          }
          if (event.type === "step") {
            setStreamSteps((prev) => [...prev, { id: event.id, label: event.label }]);
          } else if (event.type === "log") {
            setStreamLogs((prev) => [...prev, event.message]);
          } else if (event.type === "error") {
            setStreamError(`${event.code ?? "ERROR"}: ${event.message}`);
            setStreaming(false);
            return;
          } else if (event.type === "done") {
            setStreaming(false);
            onComplete(event.tenant);
            return;
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStreamError(err instanceof Error ? err.message : "Provision failed");
      setStreaming(false);
    }
  }, [selectedTemplate, slug, name, slugValid, onComplete]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // -------------------------------------------------------------------- UI
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">New Project</h2>
            <span className="text-xs text-muted-foreground">Step {step} of 3</span>
          </div>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto p-5">
          {step === 1 ? (
            <Step1Templates
              templates={templates}
              error={templatesError}
              selected={selectedTemplate}
              onSelect={(t) => {
                setSelectedTemplate(t);
                setStep(2);
              }}
            />
          ) : step === 2 ? (
            <Step2Naming
              name={name}
              slug={slug}
              slugValid={slugValid}
              onNameChange={onNameChange}
              onSlugChange={(value) => {
                setSlug(value);
                setSlugTouched(true);
              }}
            />
          ) : (
            <Step3Provision
              template={selectedTemplate}
              name={name}
              slug={slug}
              streaming={streaming}
              streamSteps={streamSteps}
              streamLogs={streamLogs}
              streamError={streamError}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border p-5">
          {step > 1 && !streaming ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <span />
          )}

          {step === 2 ? (
            <button
              type="button"
              disabled={!slugValid || !selectedTemplate}
              onClick={() => setStep(3)}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          ) : null}

          {step === 3 && !streaming && !streamError ? (
            <button
              type="button"
              onClick={startProvision}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              <Rocket size={14} /> Create project
            </button>
          ) : null}
          {step === 3 && streamError ? (
            <button
              type="button"
              onClick={startProvision}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- subcomponents

function Step1Templates({
  templates,
  error,
  selected,
  onSelect,
}: {
  templates: Template[] | null;
  error: string | null;
  selected: Template | null;
  onSelect: (t: Template) => void;
}) {
  if (templates === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Loading templates…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-foreground">
        <AlertCircle size={16} className="mt-0.5" />
        <div>
          <p className="font-medium">Failed to load templates</p>
          <p className="mt-1 text-xs opacity-80">{error}</p>
        </div>
      </div>
    );
  }
  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No public templates available in the olonjs org right now.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {templates.map((t) => {
        const isSelected = selected?.owner === t.owner && selected?.repo === t.repo;
        return (
          <li key={`${t.owner}/${t.repo}`}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              className={`flex w-full flex-col items-start gap-2 rounded-lg border p-4 text-left transition ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-ring/50 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Package size={14} className="text-muted-foreground" />
                <span className="font-medium">{t.repo}</span>
                {isSelected ? <Check size={14} className="text-primary" /> : null}
              </div>
              {t.description ? (
                <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Step2Naming({
  name,
  slug,
  slugValid,
  onNameChange,
  onSlugChange,
}: {
  name: string;
  slug: string;
  slugValid: boolean;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="tenant-name">
          Project name
        </label>
        <input
          id="tenant-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My new site"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="tenant-slug">
          Slug
        </label>
        <input
          id="tenant-slug"
          type="text"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          placeholder="my-new-site"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, and dashes. 1–40 chars. Used as the GitHub
          repo name and Vercel project slug.
          {/* TODO(T-106 follow-up): live availability check against GitHub +
              Vercel with auto-suffix on collision. */}
        </p>
        {slug && !slugValid ? (
          <p className="text-xs text-destructive-foreground">
            Slug must start/end with a letter or digit and contain only [a-z0-9-].
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Step3Provision({
  template,
  name,
  slug,
  streaming,
  streamSteps,
  streamLogs,
  streamError,
}: {
  template: Template | null;
  name: string;
  slug: string;
  streaming: boolean;
  streamSteps: { id: string; label: string }[];
  streamLogs: string[];
  streamError: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border p-4 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Review</p>
        <dl className="mt-2 space-y-1">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Template</dt>
            <dd className="font-mono">{template ? `${template.owner}/${template.repo}` : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{name || slug}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono">{slug}</dd>
          </div>
        </dl>
      </div>

      {streaming || streamSteps.length > 0 || streamError ? (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Progress</p>
          <ul className="space-y-1.5 text-sm">
            {streamSteps.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex items-center gap-2">
                <Check size={14} className="text-emerald-500" />
                <span>{s.label}</span>
              </li>
            ))}
            {streaming ? (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Working…
              </li>
            ) : null}
          </ul>
          {streamLogs.length > 0 ? (
            <details className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Logs ({streamLogs.length})</summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                {streamLogs.join("\n")}
              </pre>
            </details>
          ) : null}
          {streamError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-foreground">
              <AlertCircle size={14} className="mt-0.5" />
              <p>{streamError}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
