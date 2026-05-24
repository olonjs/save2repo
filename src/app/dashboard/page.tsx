"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Terminal, Plus, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { CreateTenantFlow } from "./components/CreateTenantFlow";
import { EntitlementsToast } from "./components/entitlements/EntitlementsToast";
import { ProjectsGrid } from "./components/projects/ProjectsGrid";
import type { ProjectCardProps } from "./components/projects/ProjectCard";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  github_installation_id?: string;
  github_repo_owner: string;
  github_repo_name: string;
  created_at?: string;
  vercel_url?: string | null;
  preview_image_url?: string | null;
  preview_updated_at?: string | null;
  preview_status?: "pending" | "ready" | "failed" | null;
}

type PurchaseState =
  | "idle"
  | "checking_bridge"
  | "bridge_missing"
  | "preparing_checkout"
  | "payment_pending"
  | "licensed_ready_unassigned"
  | "licensed_ready_assigned"
  | "licensed_ready"
  | "error";

interface PurchaseContext {
  state: PurchaseState;
  message: string;
  checkoutUrl: string | null;
  installationId: number | null;
  errorCode: string | null;
  correlationId: string | null;
  planCode: "starter" | "pro" | "business" | null;
}

export interface PendingEntitlement {
  id: string;
  planCode: "starter" | "pro" | "business";
  correlationId: string;
  installationId: number | null;
  updatedAt: string;
}

type PlanCode = "starter" | "pro" | "business";
type CheckoutSource = "cloud" | "app";

function isSafeCheckoutUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("lemonsqueezy.com");
  } catch {
    return false;
  }
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlanCode(value: string | null | undefined): value is PlanCode {
  return value === "starter" || value === "pro" || value === "business";
}

function isCheckoutSource(value: string | null | undefined): value is CheckoutSource {
  return value === "cloud" || value === "app";
}

function resolveCheckoutSourceFromReferrer(): CheckoutSource {
  if (typeof document === "undefined") return "app";
  const referrer = document.referrer;
  if (!referrer) return "app";
  try {
    const url = new URL(referrer);
    return url.hostname === "cloud.jsonpages.io" ? "cloud" : "app";
  } catch {
    return "app";
  }
}

function selectFifoPending(entitlements: PendingEntitlement[]): PendingEntitlement | null {
  if (entitlements.length === 0) return null;
  return [...entitlements].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0];
}

const PREVIEW_PENDING_STALE_MS = 10 * 60 * 1000;
const PREVIEW_RETRY_COOLDOWN_MS = 90 * 1000;
const PREVIEW_POLL_FAST_MS = 3000;
const PREVIEW_POLL_SLOW_MS = 8000;
const PREVIEW_POST_CREATE_RETRY_WINDOW_MS = 2 * 60 * 1000;
const PREVIEW_PRIORITY_RETRY_COOLDOWN_MS = 15 * 1000;

function isPreviewPendingStale(tenant: Tenant): boolean {
  if (tenant.preview_status !== "pending") return false;
  if (!tenant.preview_updated_at) return true;
  const ts = new Date(tenant.preview_updated_at).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= PREVIEW_PENDING_STALE_MS;
}

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [installations, setInstallations] = useState<any[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [configureUrl, setConfigureUrl] = useState<string | null>(null);
  const [installationsError, setInstallationsError] = useState<string | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseContext>({
    state: "idle",
    message: "",
    checkoutUrl: null,
    installationId: null,
    errorCode: null,
    correlationId: null,
    planCode: null,
  });
  const [pendingEntitlements, setPendingEntitlements] = useState<PendingEntitlement[]>([]);
  const [resumeEntitlement, setResumeEntitlement] = useState<PendingEntitlement | null>(null);
  const [previewRefreshInFlightIds, setPreviewRefreshInFlightIds] = useState<Set<string>>(new Set());
  const subscribeFlowStarted = useRef(false);
  const subscribeConfirmationLockedRef = useRef(false);
  const checkoutStatusRecoveryRef = useRef<Set<string>>(new Set());
  const previewBootstrapInFlightRef = useRef<Set<string>>(new Set());
  const previewBootstrapRetryAfterRef = useRef<Map<string, number>>(new Map());
  const previewBootstrapFreshUntilRef = useRef<Map<string, number>>(new Map());

  const loadProjects = useCallback(async (): Promise<Tenant[]> => {
    const { data } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    const rows = Array.isArray(data) ? (data as Tenant[]) : [];
    setProjects(rows);
    return rows;
  }, []);
//git push comment
  const requestPreviewBootstrap = useCallback(
    async (tenantIds: string[], options?: { reason?: string; priority?: boolean; force?: boolean }) => {
      const now = Date.now();
      const uniqueIds = Array.from(new Set(tenantIds.filter(Boolean)));
      const force = options?.force === true;
      const allowedIds = uniqueIds
        .filter((id) => !previewBootstrapInFlightRef.current.has(id))
        .filter((id) => force || (previewBootstrapRetryAfterRef.current.get(id) ?? 0) <= now);
      if (allowedIds.length === 0) return;

      const reason = options?.reason ?? "dashboard_scan";
      const priority = options?.priority === true;
      const retryCooldownMs = priority ? PREVIEW_PRIORITY_RETRY_COOLDOWN_MS : PREVIEW_RETRY_COOLDOWN_MS;
      const priorityIds = priority ? allowedIds : [];
      const prioritySet = new Set(priorityIds);
      let priorityQueued = 0;
      let priorityFailed = 0;

      for (const id of allowedIds) {
        previewBootstrapInFlightRef.current.add(id);
      }

      const correlationId = crypto.randomUUID();
      const clearInFlight = () => {
        for (const id of allowedIds) {
          previewBootstrapInFlightRef.current.delete(id);
        }
      };
      const applyRetryCooldown = (ids: string[]) => {
        const retryAt = Date.now() + retryCooldownMs;
        for (const id of ids) {
          previewBootstrapRetryAfterRef.current.set(id, retryAt);
        }
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        clearInFlight();
        applyRetryCooldown(allowedIds);
        console.warn("[dashboard.preview.bootstrap.skipped_no_token]", {
          correlationId,
          tenantIds: allowedIds,
          reason,
          priority,
          force,
          retryAfterMs: retryCooldownMs,
        });
        return;
      }

      try {
        const res = await fetch("/api/v1/tenants/previews/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Correlation-Id": correlationId,
          },
          body: JSON.stringify({
            tenantIds: allowedIds,
            priorityTenantIds: priorityIds,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          queued?: number;
          completed?: number;
          failed?: Array<{ tenantId: string; errorCode: string; error: string }>;
        };
        const failedMap = new Map((payload.failed ?? []).map((item) => [item.tenantId, item]));
        const failedIds = Array.from(failedMap.keys());
        for (const id of allowedIds) {
          if (!failedMap.has(id)) {
            previewBootstrapRetryAfterRef.current.delete(id);
            if (prioritySet.has(id)) priorityQueued += 1;
          } else if (prioritySet.has(id)) {
            priorityFailed += 1;
          }
        }
        clearInFlight();
        applyRetryCooldown(failedIds);
        console.info("[dashboard.preview.bootstrap.request_sent]", {
          correlationId,
          tenantIds: allowedIds,
          reason,
          priority,
          force,
          status: res.status,
        });
        console.info("[dashboard.preview.bootstrap.result]", {
          correlationId,
          reason,
          priority,
          queued: payload.queued ?? allowedIds.length,
          completed: payload.completed ?? 0,
          failedCount: failedMap.size,
          next_retry_ms: failedMap.size > 0 ? retryCooldownMs : 0,
          priorityQueued: payload.queued ?? priorityQueued,
          priorityFailed,
        });
        if (failedMap.size > 0) {
          const failures = Array.from(failedMap.values());
          console.error("[dashboard.preview.bootstrap.failed]", failures);
          failures.forEach((f) => {
            console.error("[dashboard.preview.bootstrap.failed_item]", f.tenantId, f.errorCode, f.error);
          });
        }
      } catch {
        clearInFlight();
        applyRetryCooldown(allowedIds);
        console.error("[dashboard.preview.bootstrap.request_error]", {
          correlationId,
          tenantIds: allowedIds,
          reason,
          priority,
          force,
          next_retry_ms: retryCooldownMs,
        });
      }
    },
    []
  );

  const queueMissingPreviews = useCallback(
    async (items: Tenant[]) => {
      const now = Date.now();
      for (const [tenantId, freshUntil] of previewBootstrapFreshUntilRef.current.entries()) {
        if (freshUntil <= now) {
          previewBootstrapFreshUntilRef.current.delete(tenantId);
        }
      }

      const missingIds = items
        .filter((tenant) => tenant.vercel_url)
        .filter((tenant) => !(tenant.preview_status === "ready" && tenant.preview_image_url))
        .filter((tenant) => {
          if (tenant.preview_status !== "pending") return true;
          const freshUntil = previewBootstrapFreshUntilRef.current.get(tenant.id) ?? 0;
          return isPreviewPendingStale(tenant) || freshUntil > now;
        })
        .map((tenant) => tenant.id);

      if (missingIds.length === 0) return;
      await requestPreviewBootstrap(missingIds, { reason: "dashboard_scan" });
    },
    [requestPreviewBootstrap]
  );

  const handleRefreshPreview = useCallback(
    async (tenantId: string) => {
      if (!tenantId) return;
      setPreviewRefreshInFlightIds((prev) => {
        const next = new Set(prev);
        next.add(tenantId);
        return next;
      });
      try {
        await requestPreviewBootstrap([tenantId], {
          reason: "dashboard_card_refresh",
          priority: true,
          force: true,
        });

        // Keep spinner tied to real preview lifecycle, not only request completion.
        const startedAt = Date.now();
        const timeoutMs = 90_000;
        const pollMs = 2_000;
        while (Date.now() - startedAt < timeoutMs) {
          const rows = await loadProjects();
          const tenant = rows.find((row) => row.id === tenantId);
          if (!tenant || tenant.preview_status !== "pending") break;
          await new Promise((resolve) => window.setTimeout(resolve, pollMs));
        }
      } finally {
        setPreviewRefreshInFlightIds((prev) => {
          const next = new Set(prev);
          next.delete(tenantId);
          return next;
        });
      }
    },
    [requestPreviewBootstrap, loadProjects]
  );

  const loadPendingEntitlements = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return;
      const res = await fetch("/api/v1/licensing/pending-entitlements", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const rows = Array.isArray(data.entitlements) ? (data.entitlements as PendingEntitlement[]) : [];
      setPendingEntitlements(rows);
    } catch {
      // best-effort UI hint
    }
  }, []);

  const loadInstallations = useCallback(async () => {
    setInstallationsError(null);
    try {
      const res = await fetch("/api/v1/github/installations");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setInstallUrl(data.installUrl ?? null);
      setConfigureUrl(data.configureUrl ?? null);
      setInstallations(data.installations ?? []);
      setInstallationsError(data.installationsError ?? null);
    } catch {
      setInstallationsError("Impossibile caricare le installazioni");
    }
  }, []);

  const getAuthHeaders = useCallback(async (correlationId?: string, source?: CheckoutSource) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error("Sessione assente o scaduta");
    }

    return {
      Authorization: `Bearer ${accessToken}`,
      "X-Correlation-Id": correlationId ?? crypto.randomUUID(),
      ...(source ? { "X-Checkout-Source": source } : {}),
    };
  }, []);

  const subscribeIntent = searchParams?.get("intent") === "subscribe";
  const subscribePlanRaw = searchParams?.get("plan");
  const subscribeInstallationId = searchParams?.get("installation_id");
  const subscribeTenantIdRaw = searchParams?.get("tenant_id");
  const subscribeSourceRaw = searchParams?.get("source");
  const subscribeCorrelationIdRaw = searchParams?.get("correlation_id");
  const subscribeTenantId = isUuid(subscribeTenantIdRaw) ? subscribeTenantIdRaw : null;
  const subscribePlan: PlanCode | null = isPlanCode(subscribePlanRaw) ? subscribePlanRaw : null;
  const subscribeSource: CheckoutSource = isCheckoutSource(subscribeSourceRaw)
    ? subscribeSourceRaw
    : resolveCheckoutSourceFromReferrer();
  const subscribeCorrelationId = subscribeCorrelationIdRaw?.trim() || null;
  const openSubscribeDecision = useCallback((params: {
    correlationId: string;
    planCode: PlanCode;
    installationId?: number | null;
    updatedAt?: string | null;
  }) => {
    subscribeConfirmationLockedRef.current = true;
    setPurchaseOpen(true);
    setPurchase((prev) => ({
      ...prev,
      state: "licensed_ready_unassigned",
      message: "Pagamento confermato. Prepariamo il tuo spazio.",
      checkoutUrl: null,
      installationId: params.installationId ?? null,
      errorCode: null,
      correlationId: params.correlationId,
      planCode: params.planCode,
    }));
    setResumeEntitlement({
      id: params.correlationId,
      planCode: params.planCode,
      correlationId: params.correlationId,
      installationId: params.installationId ?? null,
      updatedAt: params.updatedAt ?? new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (subscribeIntent && subscribePlan) {
          const nextTarget = `/dashboard${window.location.search}`;
          router.push(`/?next=${encodeURIComponent(nextTarget)}`);
        } else {
          router.push("/");
        }
        return;
      }
      setUser(user);
      const loadedProjects = await loadProjects();
      void queueMissingPreviews(loadedProjects);
      await loadPendingEntitlements();
      setLoading(false);
    };
    init();
  }, [router, loadProjects, loadPendingEntitlements, queueMissingPreviews, subscribeIntent, subscribePlan]);

  useEffect(() => {
    if (!user) return;
    if (!projects.some((project) => project.preview_status === "pending" || project.preview_status === "failed")) return;

    const hasPending = projects.some((project) => project.preview_status === "pending");
    const pollIntervalMs = hasPending ? PREVIEW_POLL_FAST_MS : PREVIEW_POLL_SLOW_MS;
    const intervalId = window.setInterval(() => {
      void loadProjects().then((rows) => queueMissingPreviews(rows));
    }, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [user, projects, loadProjects, queueMissingPreviews]);

  useEffect(() => {
    const installationId = searchParams?.get("installation_id");
    if (installationId && !subscribeIntent) {
      setShowCreateModal(true);
      loadInstallations();
    }
  }, [searchParams?.get("installation_id"), loadInstallations, subscribeIntent]);

  const runSubscribeFlow = useCallback(async (options?: { forceNewCheckout?: boolean }) => {
    if (!options?.forceNewCheckout && subscribeConfirmationLockedRef.current) {
      setPurchaseOpen(true);
      return;
    }

    if (!subscribePlan) {
      setPurchaseOpen(true);
      setPurchase({
        state: "error",
        message: "Piano non valido. Usa una card pricing supportata.",
        checkoutUrl: null,
        installationId: null,
        errorCode: "ERR_PLAN_INVALID",
        correlationId: null,
        planCode: null,
      });
      return;
    }

    try {
      setPurchaseOpen(true);
      const flowCorrelationId = purchase.correlationId ?? subscribeCorrelationId ?? crypto.randomUUID();
      const headers = await getAuthHeaders(flowCorrelationId, subscribeSource);
      let forceNewCheckout = options?.forceNewCheckout === true;
      const tenantIdForFlow = subscribeTenantId;

      const statusUrl = new URL("/api/v1/licensing/checkout-status", window.location.origin);
      statusUrl.searchParams.set("plan", subscribePlan);
      statusUrl.searchParams.set("source", subscribeSource);
      if (tenantIdForFlow) statusUrl.searchParams.set("tenant_id", tenantIdForFlow);
      statusUrl.searchParams.set("correlation_id", flowCorrelationId);
      const statusRes = await fetch(
        statusUrl.toString(),
        {
        method: "GET",
        headers,
        }
      );
      const statusData = await statusRes.json();
      if (!statusRes.ok) {
        throw new Error(statusData.error || "Errore durante il recupero stato checkout");
      }

      const isRecoveredPreviousEntitlement =
        statusData.state === "licensed_ready_unassigned" &&
        statusData.resolvedViaFallback === true &&
        !!statusData.correlationId &&
        statusData.correlationId !== flowCorrelationId &&
        !subscribeCorrelationId;

      if (!forceNewCheckout && statusData.state === "licensed_ready_unassigned" && !isRecoveredPreviousEntitlement) {
        const correlation = statusData.correlationId ?? flowCorrelationId;
        openSubscribeDecision({
          correlationId: correlation,
          planCode: subscribePlan,
          installationId: statusData.installationId ?? null,
          updatedAt: statusData.updatedAt ?? null,
        });
        await loadInstallations();
        await loadPendingEntitlements();
        return;
      }

      const alreadyLicensed =
        statusData.state === "licensed_ready_assigned" || statusData.state === "licensed_ready";
      if (alreadyLicensed) {
        setShowCreateModal(false);
        setResumeEntitlement(null);
        setPurchase({
          state: "checking_bridge",
          message: "Preparazione nuovo checkout...",
          checkoutUrl: null,
          installationId: null,
          errorCode: null,
          correlationId: flowCorrelationId,
          planCode: subscribePlan,
        });
      }

      if (!forceNewCheckout && statusData.checkoutUrl && !isSafeCheckoutUrl(statusData.checkoutUrl)) {
        forceNewCheckout = true;
      }
      if (!forceNewCheckout && statusData.checkoutRecoveryRequired === true) {
        forceNewCheckout = true;
      }
      if (!forceNewCheckout && statusData.checkoutReusable === false) {
        forceNewCheckout = true;
      }
      if (
        !forceNewCheckout &&
        (statusData.state === "checkout_created" || statusData.state === "payment_pending") &&
        !isSafeCheckoutUrl(statusData.checkoutUrl)
      ) {
        forceNewCheckout = true;
      }

      if (
        !forceNewCheckout &&
        statusData.checkoutUrl &&
        (statusData.state === "checkout_created" || statusData.state === "payment_pending")
      ) {
        setPurchase({
          state: "payment_pending",
          message: "Checkout pronto. Completa il pagamento nell'overlay.",
          checkoutUrl: statusData.checkoutUrl,
          installationId: statusData.installationId ?? null,
          errorCode: null,
          correlationId: statusData.correlationId ?? flowCorrelationId,
          planCode: subscribePlan,
        });
        return;
      }

      setPurchase({
        state: "checking_bridge",
        message: "Checking GitHub access...",
        checkoutUrl: null,
        installationId: null,
        errorCode: null,
        correlationId: flowCorrelationId,
        planCode: subscribePlan,
      });

      const bridgeUrl = new URL("/api/v1/licensing/bridge-status", window.location.origin);
      bridgeUrl.searchParams.set("plan", subscribePlan);
      bridgeUrl.searchParams.set("source", subscribeSource);
      bridgeUrl.searchParams.set("correlation_id", flowCorrelationId);
      if (tenantIdForFlow) bridgeUrl.searchParams.set("tenant_id", tenantIdForFlow);
      if (subscribeInstallationId) bridgeUrl.searchParams.set("installation_id", subscribeInstallationId);

      const bridgeRes = await fetch(bridgeUrl.toString(), { method: "GET", headers });
      const bridgeData = await bridgeRes.json();
      if (!bridgeRes.ok) {
        throw new Error(bridgeData.error || "Errore durante la verifica bridge GitHub");
      }

      if (bridgeData.state !== "bridge_ready" || !bridgeData.selectedInstallationId) {
        await loadInstallations();
        setPurchase({
          state: "bridge_missing",
          message: "Connect GitHub per continuare con il checkout sicuro.",
          checkoutUrl: null,
          installationId: null,
          errorCode: "ERR_BRIDGE_MISSING",
          correlationId: flowCorrelationId,
          planCode: subscribePlan,
        });
        return;
      }

      setPurchase({
        state: "preparing_checkout",
        message: "Preparing secure checkout...",
        checkoutUrl: null,
        installationId: bridgeData.selectedInstallationId,
        errorCode: null,
        correlationId: flowCorrelationId,
        planCode: subscribePlan,
      });

      const checkoutRes = await fetch("/api/v1/licensing/create-checkout", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: subscribePlan,
          source: subscribeSource,
          correlationId: flowCorrelationId,
          tenantId: tenantIdForFlow,
          installationId: bridgeData.selectedInstallationId,
          forceNew: forceNewCheckout,
        }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) {
        if (checkoutData.code === "ERR_TENANT_PLAN_ALREADY_LICENSED") {
          setPurchase({
            state: "licensed_ready_assigned",
            message: "Licenza gia attiva per questo tenant.",
            checkoutUrl: null,
            installationId: bridgeData.selectedInstallationId ?? null,
            errorCode: null,
            correlationId: checkoutData.correlationId ?? flowCorrelationId,
            planCode: subscribePlan,
          });
          return;
        }
        throw new Error(checkoutData.error || "Errore durante la creazione checkout");
      }
      if (!isSafeCheckoutUrl(checkoutData.checkoutUrl ?? null)) {
        throw new Error("Checkout URL non valido, genera un nuovo checkout.");
      }

      setPurchase({
        state: "payment_pending",
        message: "Waiting payment confirmation...",
        checkoutUrl: checkoutData.checkoutUrl ?? null,
        installationId: bridgeData.selectedInstallationId,
        errorCode: null,
        correlationId: checkoutData.correlationId ?? flowCorrelationId,
        planCode: subscribePlan,
      });
    } catch (error: any) {
      setPurchase({
        state: "error",
        message: error?.message || "Errore nel flusso Subscribe",
        checkoutUrl: null,
        installationId: null,
        errorCode: "ERR_SUBSCRIBE_FLOW_FAILED",
        correlationId: purchase.correlationId ?? subscribeCorrelationId ?? null,
        planCode: subscribePlan,
      });
    }
  }, [
    subscribePlan,
    subscribeTenantId,
    subscribeInstallationId,
    subscribeSource,
    subscribeCorrelationId,
    getAuthHeaders,
    loadInstallations,
    loadPendingEntitlements,
    purchase.correlationId,
    searchParams,
  ]);

  useEffect(() => {
    subscribeFlowStarted.current = false;
  }, [subscribePlan, subscribeIntent, subscribeInstallationId, subscribeTenantId, user?.id]);

  useEffect(() => {
    if (!user || !subscribeIntent || !subscribePlan) return;
    if (subscribeFlowStarted.current) return;
    subscribeFlowStarted.current = true;
    runSubscribeFlow();
  }, [user, subscribeIntent, subscribePlan, runSubscribeFlow]);

  useEffect(() => {
    if (!subscribeIntent || !subscribePlan) return;
    if (purchase.state !== "payment_pending" && purchase.state !== "preparing_checkout") return;

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const headers = await getAuthHeaders(purchase.correlationId ?? undefined, subscribeSource);
        const tenantId = subscribeTenantId && isUuid(subscribeTenantId) ? subscribeTenantId : null;
        const statusUrl = new URL("/api/v1/licensing/checkout-status", window.location.origin);
        statusUrl.searchParams.set("plan", subscribePlan);
        statusUrl.searchParams.set("source", subscribeSource);
        if (tenantId) statusUrl.searchParams.set("tenant_id", tenantId);
        if (purchase.correlationId) statusUrl.searchParams.set("correlation_id", purchase.correlationId);
        const statusRes = await fetch(
          statusUrl.toString(),
          {
            method: "GET",
            headers,
          }
        );
        const statusData = await statusRes.json();
        if (!statusRes.ok) return;

        if (statusData.state === "authenticated") {
          const recoveryKey = `${subscribePlan}:${purchase.correlationId ?? "none"}`;
          if (!checkoutStatusRecoveryRef.current.has(recoveryKey)) {
            checkoutStatusRecoveryRef.current.add(recoveryKey);
            console.info("[dashboard.subscribe.poll.status_not_found]", {
              plan: subscribePlan,
              correlationId: purchase.correlationId ?? null,
            });
            void runSubscribeFlow({ forceNewCheckout: false });
          }
          return;
        }

        if (statusData.state === "licensed_ready_assigned" || statusData.state === "licensed_ready") {
          console.info("[dashboard.subscribe.poll.still_pending]", {
            state: statusData.state,
            correlationId: statusData.correlationId ?? purchase.correlationId ?? null,
            resolvedViaFallback: statusData.resolvedViaFallback === true,
          });
          setPurchase((prev) => ({
            ...prev,
            state: "licensed_ready_assigned",
            message: "Pagamento confermato lato backend.",
            checkoutUrl: null,
            errorCode: null,
          }));
          await loadPendingEntitlements();
        }

        if (statusData.state === "licensed_ready_unassigned") {
          console.info("[dashboard.subscribe.poll.fallback_recovered]", {
            state: statusData.state,
            correlationId: statusData.correlationId ?? purchase.correlationId ?? null,
            resolvedViaFallback: statusData.resolvedViaFallback === true,
          });
          const correlation = statusData.correlationId ?? purchase.correlationId;
          if (correlation) {
            openSubscribeDecision({
              correlationId: correlation,
              planCode: (purchase.planCode ?? subscribePlan) as PlanCode,
              installationId: statusData.installationId ?? null,
              updatedAt: statusData.updatedAt ?? null,
            });
            await loadInstallations();
          }
          await loadPendingEntitlements();
        }
      } catch {
        // polling best-effort
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [purchase.state, purchase.correlationId, purchase.planCode, subscribeIntent, subscribePlan, subscribeTenantId, getAuthHeaders, loadPendingEntitlements, runSubscribeFlow]);

  const handleOpenCreate = () => {
    setResumeEntitlement(null);
    setShowCreateModal(true);
    loadInstallations();
  };

  const handleCreateComplete = (tenant: { id: string; name: string; slug: string }) => {
    subscribeConfirmationLockedRef.current = false;
    setPurchaseOpen(false);
    setShowCreateModal(false);
    setResumeEntitlement(null);
    loadPendingEntitlements();
    if (tenant.id) {
      previewBootstrapFreshUntilRef.current.set(tenant.id, Date.now() + PREVIEW_POST_CREATE_RETRY_WINDOW_MS);
      void loadProjects().then((rows) => {
        void queueMissingPreviews(rows);
      });
      void requestPreviewBootstrap([tenant.id], {
        reason: "post_create_handoff",
        priority: true,
      });
      router.push(`/dashboard/${tenant.id}?tab=overview`);
    }
  };

  const handleCreateLater = () => {
    subscribeConfirmationLockedRef.current = false;
    setPurchaseOpen(false);
    setShowCreateModal(false);
    setResumeEntitlement(null);
    loadPendingEntitlements();
  };

  const handleCreateNowFromDecision = () => {
    // Keep selected entitlement bound during provisioning.
    // It is cleared only on complete/later/close flows.
  };

  const handleEntitlementConflict = async () => {
    const previous = resumeEntitlement?.correlationId ?? null;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setShowCreateModal(false);
        setResumeEntitlement(null);
        return;
      }
      const res = await fetch("/api/v1/licensing/pending-entitlements", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const entitlements = Array.isArray(data.entitlements) ? (data.entitlements as PendingEntitlement[]) : [];
      setPendingEntitlements(entitlements);
      const fifo = selectFifoPending(entitlements.filter((item) => item.correlationId !== previous));
      if (!fifo) {
        setShowCreateModal(false);
        setResumeEntitlement(null);
        return;
      }
      await loadInstallations();
      if (subscribeIntent) {
        openSubscribeDecision({
          correlationId: fifo.correlationId,
          planCode: fifo.planCode,
          installationId: fifo.installationId,
          updatedAt: fifo.updatedAt,
        });
      } else {
        setResumeEntitlement(fifo);
        setShowCreateModal(true);
      }
    } catch {
      // best effort recovery
    }
  };

  const fifoPending = selectFifoPending(pendingEntitlements);
  const showPendingBanner =
    pendingEntitlements.length > 0 &&
    (!resumeEntitlement || !fifoPending || resumeEntitlement.correlationId !== fifoPending.correlationId);

  const mappedProjects: ProjectCardProps[] = useMemo(
    () =>
      projects.map((project) => {
        const fallbackUrl = project.slug ? `https://${project.slug}.jsonpages.app` : "";
        const publicUrl = project.vercel_url || fallbackUrl || "#";
        const repoLabel = `${project.github_repo_owner}/${project.github_repo_name}`;
        const isLive = !!project.vercel_url;

        return {
          id: project.id,
          name: project.name,
          slug: project.slug,
          publicUrl,
          repoLabel,
          previewImageUrl: project.preview_image_url ?? null,
          previewStatus: project.preview_status ?? null,
          isLive,
          onRefreshPreview: () => {
            void handleRefreshPreview(project.id);
          },
          isRefreshingPreview: previewRefreshInFlightIds.has(project.id),
        };
      }),
    [projects, handleRefreshPreview, previewRefreshInFlightIds]
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-mono text-sm text-muted-foreground">
        <span className="animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <>
      <div className="w-full px-5 pb-10 pt-8 bg-background">
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-6 px-5">
          {showPendingBanner && (
            <EntitlementsToast
              pendingCount={pendingEntitlements.length}
              fifoPending={fifoPending}
              onResume={() => {
                loadInstallations();
                setResumeEntitlement(fifoPending);
                setShowCreateModal(true);
              }}
            />
          )}

          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-display tracking-tight">Projects</h1>
              <p className="mt-1 text-sm text-muted-foreground">Manage your sovereign tenants.</p>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:border-ring/50 hover:bg-card/70"
            >
              <Plus size={16} /> New Project
            </button>
          </header>

          {mappedProjects.length > 0 ? (
            <ProjectsGrid projects={mappedProjects} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
                <Terminal size={32} className="text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-foreground">No projects yet</h3>
              <p className="mb-8 max-w-md text-sm text-muted-foreground">
                Provision a new project from a template or from an existing GitHub repository.
              </p>
              <button
                type="button"
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:border-ring/50 hover:bg-card/70"
              >
                <Plus size={16} /> New Project
              </button>
            </div>
          )}
        </div>
      </div>

      {purchaseOpen && subscribeIntent && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-3xl bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Starter Checkout</h3>
                <p className="text-xs text-muted-foreground">Landing-first purchase flow</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  subscribeConfirmationLockedRef.current = false;
                  setPurchaseOpen(false);
                }}
                className="text-xs px-2 py-1 border border-border rounded hover:bg-muted"
              >
                Close
              </button>
            </div>

            <div className={`p-5 space-y-4 transition-opacity duration-[350ms] ease-out ${purchase.state === "licensed_ready_unassigned" && resumeEntitlement ? "min-h-[320px]" : ""}`}>
              {purchase.state === "licensed_ready_unassigned" && resumeEntitlement ? (
                <div className="flex justify-center animate-in fade-in slide-in-from-bottom-1 duration-[350ms] ease-out">
                  <CreateTenantFlow
                    key={resumeEntitlement.correlationId}
                    embedded
                    onClose={() => {
                      subscribeConfirmationLockedRef.current = false;
                      setPurchaseOpen(false);
                      setResumeEntitlement(null);
                    }}
                    onComplete={handleCreateComplete}
                    onCreateNowFromDecision={handleCreateNowFromDecision}
                    onCreateLater={handleCreateLater}
                    onEntitlementConflict={handleEntitlementConflict}
                    entitlementDecisionMode
                    entitlementCorrelationId={resumeEntitlement.correlationId}
                    entitlementPlanCode={resumeEntitlement.planCode}
                    entitlementUpdatedAt={resumeEntitlement.updatedAt}
                    initialInstallationId={resumeEntitlement.installationId ? String(resumeEntitlement.installationId) : searchParams?.get("installation_id")}
                    installUrl={installUrl}
                    configureUrl={configureUrl}
                    installations={installations}
                    installationsError={installationsError}
                    loadInstallations={loadInstallations}
                  />
                </div>
              ) : (
                <>
                  <div className="text-sm text-foreground/90 flex items-center gap-2">
                    {(purchase.state === "checking_bridge" || purchase.state === "preparing_checkout") && (
                      <Loader2 size={15} className="animate-spin text-primary-light" />
                    )}
                    {(purchase.state === "licensed_ready" ||
                      purchase.state === "licensed_ready_assigned" ||
                      purchase.state === "licensed_ready_unassigned") && (
                      <CheckCircle2 size={15} className="text-green-400" />
                    )}
                    {purchase.state === "error" && <AlertCircle size={15} className="text-destructive-foreground" />}
                    <span>{purchase.message || "Authenticating..."}</span>
                  </div>

                  {purchase.state === "bridge_missing" && (
                <div className="border border-warning-border bg-warning/20 rounded-lg p-3 text-sm text-warning-foreground">
                  <p>Bridge GitHub mancante. Installa o configura la GitHub App, poi torna qui.</p>
                  <div className="mt-3 flex gap-2">
                    {installUrl && (
                      <a
                        href={installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded bg-warning/30 hover:bg-warning/50"
                      >
                        Connect GitHub
                      </a>
                    )}
                    {configureUrl && (
                      <a
                        href={configureUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded border border-warning-border hover:bg-warning/20"
                      >
                        Configure
                      </a>
                    )}
                  </div>
                </div>
              )}

              {purchase.state === "payment_pending" && purchase.checkoutUrl && (
                <div className="space-y-3">
                  <iframe
                    src={purchase.checkoutUrl}
                    title="Lemon Squeezy Checkout"
                    className="w-full h-[520px] border border-border rounded-lg bg-background"
                  />
                  <div className="flex gap-2">
                    <a
                      href={purchase.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded border border-border text-sm hover:bg-muted"
                    >
                      Open in new tab
                    </a>
                    <button
                      type="button"
                      onClick={() => runSubscribeFlow({ forceNewCheckout: true })}
                      className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                    >
                      Generate new checkout
                    </button>
                  </div>
                </div>
              )}

              {purchase.state === "error" && (
                    <p className="text-xs text-destructive-foreground font-mono">code: {purchase.errorCode ?? "ERR_UNKNOWN"}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateModal && !subscribeIntent && (
        <CreateTenantFlow
          key={resumeEntitlement?.correlationId ?? "new-project-flow"}
          onClose={() => setShowCreateModal(false)}
          onComplete={handleCreateComplete}
          onCreateNowFromDecision={handleCreateNowFromDecision}
          onCreateLater={handleCreateLater}
          onEntitlementConflict={handleEntitlementConflict}
          entitlementDecisionMode={!!resumeEntitlement}
          entitlementCorrelationId={resumeEntitlement?.correlationId ?? null}
          entitlementPlanCode={resumeEntitlement?.planCode ?? null}
          entitlementUpdatedAt={resumeEntitlement?.updatedAt ?? null}
          initialInstallationId={resumeEntitlement?.installationId ? String(resumeEntitlement.installationId) : searchParams?.get("installation_id")}
          installUrl={installUrl}
          configureUrl={configureUrl}
          installations={installations}
          installationsError={installationsError}
          loadInstallations={loadInstallations}
        />
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground font-mono text-sm">
          <span className="animate-pulse">Loading...</span>
        </div>
      }
    >
      <DashboardPageContent />
    </Suspense>
  );
}
