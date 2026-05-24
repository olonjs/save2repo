"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  Save,
} from "lucide-react";

// ----------------------------------------------------------------------------
// /dashboard/[id]/edit?path=<path> (T-107)
//
// Single-owner content editor: reads/writes a single file in the tenant's
// GitHub repo via /api/v1/tenants/[id]/content (which routes through
// githubContent → Octokit → olonjs token-signing). Default path = `jsp.json`.
//
// Save model = save2repo only (ADR-005): manual save button commits a single
// file via the API route; Vercel rebuilds automatically on push. Auto-save
// with 5–30s debounce (T-107 plan) is wired but the user controls whether
// auto-save fires by toggling the input below. The full save-stream
// orchestration (commit → vercel rebuild → ready, with SSE progress) lands
// in T-108.
//
// Editor is a raw textarea — JSON/YAML linting + structured form view are
// deferred follow-ups.
// ----------------------------------------------------------------------------

const DEFAULT_PATH = "jsp.json";
const AUTOSAVE_DEBOUNCE_MS = 8000;

type SaveStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "saving"; step?: string; logs: string[] }
  | { state: "saved"; at: number; liveUrl: string | null }
  | { state: "error"; message: string };

export default function EditPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const tenantId = params.id;
  const path = searchParams.get("path") || DEFAULT_PATH;

  const [content, setContent] = useState<string>("");
  const [sha, setSha] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ state: "loading" });
  const debounceRef = useRef<number | null>(null);

  // ----- Auth helper -----
  const authHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) return null;
    return { Authorization: `Bearer ${accessToken}` };
  }, []);

  // ----- Initial load -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus({ state: "loading" });
      const headers = await authHeaders();
      if (!headers) {
        if (!cancelled) setStatus({ state: "error", message: "Not authenticated" });
        return;
      }
      try {
        const res = await fetch(
          `/api/v1/tenants/${tenantId}/content?path=${encodeURIComponent(path)}`,
          { headers, cache: "no-store" },
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            // New file path — start empty, sha will be omitted on first save (create).
            setContent("");
            setSha(null);
            setStatus({ state: "idle" });
            return;
          }
          setStatus({ state: "error", message: data?.error ?? `HTTP ${res.status}` });
          return;
        }
        setContent(typeof data.content === "string" ? data.content : "");
        setSha(typeof data.sha === "string" ? data.sha : null);
        setStatus({ state: "idle" });
        setDirty(false);
      } catch (err) {
        if (cancelled) return;
        setStatus({ state: "error", message: err instanceof Error ? err.message : "Load failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, path, authHeaders]);

  // ----- Save (T-108 SSE: commit → rebuild → live) -----
  const save = useCallback(async () => {
    setStatus({ state: "saving", logs: [] });
    const headers = await authHeaders();
    if (!headers) {
      setStatus({ state: "error", message: "Not authenticated" });
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/save-stream`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ path, content, sha: sha ?? undefined }),
        },
      );
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        setStatus({ state: "error", message: `save-stream ${res.status}: ${text.slice(0, 200)}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const logs: string[] = [];
      let currentStep: string | undefined;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (event.type === "step" && typeof event.label === "string") {
            currentStep = event.label;
            setStatus({ state: "saving", step: currentStep, logs: [...logs] });
          } else if (event.type === "log" && typeof event.message === "string") {
            logs.push(event.message);
            setStatus({ state: "saving", step: currentStep, logs: [...logs] });
          } else if (event.type === "error") {
            const code = typeof event.code === "string" ? event.code : "ERR";
            const msg = typeof event.message === "string" ? event.message : "Save failed";
            setStatus({ state: "error", message: `${code}: ${msg}` });
            return;
          } else if (event.type === "done") {
            const newSha = typeof event.sha === "string" ? event.sha : sha;
            const liveUrl = typeof event.liveUrl === "string" ? event.liveUrl : null;
            setSha(newSha);
            setDirty(false);
            setStatus({ state: "saved", at: Date.now(), liveUrl });
            return;
          }
        }
      }
    } catch (err) {
      setStatus({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  }, [tenantId, path, content, sha, authHeaders]);

  // ----- Autosave debounce -----
  useEffect(() => {
    if (!autosave || !dirty) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [autosave, dirty, content, save]);

  const onChange = (value: string) => {
    setContent(value);
    setDirty(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-5 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/${tenantId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Edit content</h1>
            <p className="font-mono text-xs text-muted-foreground">{path}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
              className="accent-primary"
            />
            Autosave (8s)
          </label>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || status.state === "saving" || status.state === "loading"}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.state === "saving" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save size={14} /> Save
              </>
            )}
          </button>
        </div>
      </header>

      <StatusLine status={status} dirty={dirty} />

      {status.state === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="min-h-[60vh] w-full resize-y rounded-md border border-border bg-card p-4 font-mono text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      )}
    </div>
  );
}

function StatusLine({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status.state === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-foreground">
        <AlertCircle size={14} className="mt-0.5" />
        <p>{status.message}</p>
      </div>
    );
  }
  if (status.state === "saving") {
    return (
      <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <div className="flex items-center gap-2 text-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>{status.step ?? "Saving…"}</span>
        </div>
        {status.logs.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Logs ({status.logs.length})
            </summary>
            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
              {status.logs.join("\n")}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }
  if (status.state === "saved") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
        <Check size={14} />
        Saved at {new Date(status.at).toLocaleTimeString()}. Site live
        {status.liveUrl ? (
          <>
            {" "}
            at{" "}
            <a
              href={status.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {status.liveUrl}
            </a>
            .
          </>
        ) : (
          " (URL not resolved)."
        )}
      </p>
    );
  }
  if (dirty) {
    return <p className="text-xs text-muted-foreground">Unsaved changes.</p>;
  }
  return null;
}
