function asFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

function asInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function isSave2RoutesBetaEnabled(): boolean {
  return asFlag(process.env.SAVE2ROUTES_BETA, false);
}

export function isSaveHotEnabled(): boolean {
  return asFlag(process.env.SAVE_HOT_ENABLED, true);
}

export function isSaveRepoEnabled(): boolean {
  return asFlag(process.env.SAVE_REPO_ENABLED, true);
}

export type Save2ContentUnscopedFallbackMode = "off" | "diagnostic" | "on";

export function isSave2ContentEmptyNamespaceDiagnosticsEnabled(): boolean {
  return asFlag(process.env.SAVE2_CONTENT_EMPTY_NAMESPACE_DIAGNOSTICS, true);
}

export function getSave2ContentUnscopedFallbackMode(): Save2ContentUnscopedFallbackMode {
  const mode = asEnum(process.env.SAVE2_CONTENT_UNSCOPED_FALLBACK_MODE, ["off", "diagnostic", "on"] as const, "off");
  if (mode !== "off") return mode;

  // Backward compatibility for old boolean flag.
  const legacyAllowUnscoped = asFlag(process.env.SAVE2_CONTENT_ALLOW_UNSCOPED_FALLBACK, false);
  return legacyAllowUnscoped ? "on" : "off";
}

export function getSave2ContentCacheTtlMs(): number {
  return asInt(process.env.SAVE2_CONTENT_CACHE_TTL_MS, 15000, 0, 120000);
}

export function getSave2ContentCacheStaleMs(): number {
  return asInt(process.env.SAVE2_CONTENT_CACHE_STALE_MS, 120000, 0, 600000);
}

export function getSave2ContentProviderRetryMaxAttempts(): number {
  return asInt(process.env.SAVE2_CONTENT_PROVIDER_RETRY_ATTEMPTS, 2, 0, 5);
}

export function getSave2ContentProviderRetryBaseDelayMs(): number {
  return asInt(process.env.SAVE2_CONTENT_PROVIDER_RETRY_BASE_DELAY_MS, 250, 50, 5000);
}

