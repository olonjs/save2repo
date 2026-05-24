"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";

type AgentScope = "read" | "write" | "submit-form";

type AgentCredential = {
  id: string;
  tenantId: string;
  clientId?: string;
  label: string;
  scopes: AgentScope[];
  secretHint: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function AgentsPanel({ tenantId, tenantSlug }: { tenantId: string; tenantSlug?: string }) {
  const scopedMcpUrl = tenantSlug
    ? `https://app.olon.it/api/v1/mcp/t/${tenantSlug}`
    : `https://app.olon.it/api/v1/mcp/t/${tenantId}`;
  const legacyMcpUrl = "https://app.olon.it/api/v1/mcp";
  const [credentials, setCredentials] = useState<AgentCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("Claude connector");
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeWrite, setScopeWrite] = useState(true);
  const [scopeSubmitForm, setScopeSubmitForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newClientId, setNewClientId] = useState<string | null>(null);
  const [newClientSecret, setNewClientSecret] = useState<string | null>(null);
  const [newSecretCredentialId, setNewSecretCredentialId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const selectedScopes = useMemo<AgentScope[]>(() => {
    const scopes: AgentScope[] = [];
    if (scopeRead) scopes.push("read");
    if (scopeWrite) scopes.push("write");
    if (scopeSubmitForm) scopes.push("submit-form");
    return scopes.length ? scopes : ["read"];
  }, [scopeRead, scopeWrite, scopeSubmitForm]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Session missing or expired");

      const res = await fetch(`/api/v1/tenants/${tenantId}/agents`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load credentials");
      }
      const nextCredentials = Array.isArray(payload.credentials) ? payload.credentials : [];
      setCredentials(nextCredentials);
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, tenantId]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const createCredential = useCallback(async () => {
    setCreating(true);
    setError(null);
    setNewClientId(null);
    setNewClientSecret(null);
    setNewSecretCredentialId(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Session missing or expired");

      const res = await fetch(`/api/v1/tenants/${tenantId}/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          label,
          scopes: selectedScopes,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Failed to create credential");
      }
      const resolvedClientId =
        typeof payload.clientId === "string"
          ? payload.clientId
          : typeof payload.credential?.clientId === "string"
            ? payload.credential.clientId
            : null;
      const resolvedClientSecret =
        typeof payload.clientSecret === "string"
          ? payload.clientSecret
          : typeof payload.secret === "string"
            ? payload.secret
            : null;

      if (resolvedClientSecret && payload.credential?.id) {
        setNewClientId(resolvedClientId);
        setNewClientSecret(resolvedClientSecret);
        setNewSecretCredentialId(payload.credential.id);
      }
      await loadCredentials();
    } catch (createError: any) {
      setError(createError?.message || "Failed to create credential");
    } finally {
      setCreating(false);
    }
  }, [getAccessToken, label, loadCredentials, selectedScopes, tenantId]);

  const revokeCredential = useCallback(
    async (credentialId: string) => {
      setRevokingId(credentialId);
      setError(null);
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Session missing or expired");
        const res = await fetch(`/api/v1/tenants/${tenantId}/agents/${credentialId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Correlation-Id": crypto.randomUUID(),
          },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.error || "Failed to revoke credential");
        }
        await loadCredentials();
      } catch (revokeError: any) {
        setError(revokeError?.message || "Failed to revoke credential");
      } finally {
        setRevokingId(null);
      }
    },
    [getAccessToken, loadCredentials, tenantId]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <Card className="border border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Remote MCP connector</CardTitle>
          <CardDescription>
            Use this with Claude custom connectors.
            <br />
            <span className="mt-2 block">
              Recommended URL (tenant-scoped):{" "}
              <span className="font-mono text-foreground">{scopedMcpUrl}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Legacy shared URL (not recommended): <span className="font-mono">{legacyMcpUrl}</span>
            </span>
            <span className="mt-2 block">
              Fill both fields in Claude: <span className="font-mono text-foreground">OAuth Client ID</span> and{" "}
              <span className="font-mono text-foreground">OAuth Client Secret</span>.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-black/30 px-2 py-1 text-xs text-foreground">{scopedMcpUrl}</code>
            <CopyButton value={scopedMcpUrl} label="Copy URL" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Credential label</label>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none"
                placeholder="Claude connector"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Scopes</label>
              <div className="flex flex-col gap-1 rounded-md border border-border bg-elevated px-3 py-2 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={scopeRead} onChange={(event) => setScopeRead(event.target.checked)} />
                  read
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={scopeWrite} onChange={(event) => setScopeWrite(event.target.checked)} />
                  write
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scopeSubmitForm}
                    onChange={(event) => setScopeSubmitForm(event.target.checked)}
                  />
                  submit-form
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={createCredential} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : null}
              {creating ? "Creating..." : "Create credential"}
            </Button>
            <Button type="button" variant="outline" onClick={loadCredentials} disabled={loading}>
              Refresh
            </Button>
          </div>

          {newClientSecret ? (
            <div className="rounded-md border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200 space-y-2">
              <div className="font-medium">Client credentials shown once. Copy now.</div>
              <div className="flex items-center gap-2 flex-wrap">
                {newClientId ? <code className="rounded bg-black/30 px-2 py-1 text-xs">client_id: {newClientId}</code> : null}
                {newClientId ? <CopyButton value={newClientId} label="Copy client_id" /> : null}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="rounded bg-black/30 px-2 py-1 text-xs">client_secret: {newClientSecret}</code>
                <CopyButton value={newClientSecret} label="Copy client_secret" />
              </div>
              {newSecretCredentialId ? (
                <div className="text-xs text-amber-100/80">Credential ID: {newSecretCredentialId}</div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive-border bg-destructive/20 p-3 text-sm text-destructive-foreground">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading credentials...
            </div>
          ) : credentials.length === 0 ? (
            <div className="text-sm text-muted-foreground">No credentials yet.</div>
          ) : (
            <div className="space-y-2">
              {credentials.map((credential) => (
                <div key={credential.id} className="rounded-md border border-border bg-elevated p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">{credential.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {credential.clientId ? `client_id: ${credential.clientId} · ` : ""}{credential.secretHint} · scopes:{" "}
                        {credential.scopes.join(", ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created: {new Date(credential.createdAt).toLocaleString()}
                        {credential.lastUsedAt ? ` · Last used: ${new Date(credential.lastUsedAt).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={Boolean(credential.revokedAt) || revokingId === credential.id}
                      onClick={() => void revokeCredential(credential.id)}
                    >
                      {revokingId === credential.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      {credential.revokedAt ? "Revoked" : "Revoke"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
