"use client";

import { supabase } from "@/lib/supabase";
import type { LeadApiError, LeadEventRecord, LeadRecord } from "./types";

function normalizeError(payload: any, status?: number): LeadApiError {
  return {
    message: typeof payload?.error === "string" ? payload.error : "Request failed",
    code: typeof payload?.code === "string" ? payload.code : null,
    status,
  };
}

async function authHeaders(extra?: Record<string, string>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw <LeadApiError>{ message: "Session missing or expired", code: "ERR_SESSION_MISSING", status: 401 };
  }
  return {
    Authorization: `Bearer ${token}`,
    "X-Correlation-Id": crypto.randomUUID(),
    ...(extra ?? {}),
  };
}

export async function apiListLeads(tenantId: string): Promise<{ rows: LeadRecord[]; count: number }> {
  const headers = await authHeaders();
  const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/leads?limit=100&offset=0`, {
    method: "GET",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return {
    rows: Array.isArray(data?.leads) ? (data.leads as LeadRecord[]) : [],
    count: Number.isFinite(data?.count) ? Number(data.count) : 0,
  };
}

export async function apiListLeadEvents(tenantId: string, leadId: string): Promise<LeadEventRecord[]> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/leads/${encodeURIComponent(leadId)}/events?limit=50`,
    {
      method: "GET",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw normalizeError(data, res.status);
  return Array.isArray(data?.events) ? (data.events as LeadEventRecord[]) : [];
}
