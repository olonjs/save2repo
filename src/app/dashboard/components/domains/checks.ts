"use client";

import type { DomainCheck, DomainRecord } from "./types";

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCheck(check: Record<string, unknown> | null): DomainCheck | null {
  const type = asOptionalString(check?.type);
  const domain = asOptionalString(check?.domain) ?? asOptionalString(check?.host);
  const value = asOptionalString(check?.value) ?? asOptionalString(check?.target);
  const reason = asOptionalString(check?.reason);
  const requiredRaw = check?.required;
  const required = typeof requiredRaw === "boolean" ? requiredRaw : null;
  if (!type && !domain && !value) return null;
  return { type, domain, value, reason, required };
}

export function checksFromTargets(targets: DomainRecord["verification_targets"]): DomainCheck[] {
  const source = Array.isArray(targets)
    ? targets
    : Array.isArray((targets as { checks?: unknown[] } | null)?.checks)
      ? (targets as { checks: unknown[] }).checks
      : Array.isArray((targets as { verification?: unknown[] } | null)?.verification)
        ? (targets as { verification: unknown[] }).verification
        : [];
  const normalized = source
    .map((entry) => normalizeCheck((entry ?? null) as Record<string, unknown> | null))
    .filter((entry): entry is DomainCheck => Boolean(entry));
  return normalized;
}

export function isCheckRequired(check: DomainCheck): boolean {
  if (typeof check.required === "boolean") return check.required;
  const reason = (check.reason ?? "").toLowerCase();
  return !reason.includes("optional");
}
