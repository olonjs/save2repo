function hasProviderConflict(config) {
  return Array.isArray(config?.conflicts) && config.conflicts.length > 0;
}

function hasVerificationChallenges(payload) {
  return Array.isArray(payload?.verification) && payload.verification.length > 0;
}

function isConfiguredByNull(config) {
  return config?.configuredBy === null;
}

function isStrictTrue(value) {
  return value === true;
}

function isStrictFalse(value) {
  return value === false;
}

/**
 * @param {{ verified?: unknown, verification?: unknown, config?: { conflicts?: unknown, misconfigured?: unknown, configuredBy?: unknown } | null }} payload
 * @param {number} checksCount
 * @returns {{ status: 'pending_dns' | 'verifying' | 'verified' | 'active' | 'conflict' | 'error' | 'deleted' }}
 */
export function deriveDomainStatusFromVercel(payload, checksCount) {
  const config = payload?.config ?? null;

  if (hasProviderConflict(config)) return { status: 'conflict' };

  const verified = payload?.verified;
  const misconfigured = config?.misconfigured;

  // Active is allowed only with explicit provider certainty:
  // project-domain verified AND domain config not misconfigured.
  if (isStrictTrue(verified) && isStrictFalse(misconfigured)) {
    return { status: 'active' };
  }

  // Pending DNS/config whenever provider reports unresolved DNS wiring.
  if (isStrictTrue(misconfigured) || isConfiguredByNull(config)) {
    return { status: 'pending_dns' };
  }

  const hasChallenges = hasVerificationChallenges(payload);
  if (isStrictFalse(verified) && (hasChallenges || checksCount > 0)) {
    return { status: 'verifying' };
  }

  // Safe fallback: never promote to active without explicit provider evidence.
  return { status: 'verifying' };
}
