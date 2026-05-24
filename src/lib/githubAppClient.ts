import { Octokit } from 'octokit';

// ----------------------------------------------------------------------------
// save2repo GitHub App client.
//
// Architecture per ADR-006: the olonjs GitHub App private key never leaves
// the olonjs backend (app.olon.it). A save2repo deployment running in the
// buyer's Vercel team calls our token-signing endpoint with its registration
// bearer token (SAVE2REPO_DEPLOYMENT_TOKEN env var) and the target
// installation_id (the buyer's GitHub App installation id, persisted in
// owner_integrations.github_installation_id). The endpoint mints and returns
// a short-lived GitHub installation access token.
//
// This module:
//   - caches the resulting Octokit instance per installation_id, with a
//     small safety buffer before the token's stated expiry;
//   - re-mints on cache miss / expiry;
//   - exposes a typed error so callers can surface clear UX when the
//     olonjs backend is unreachable or the bearer is rejected.
//
// Provisioning, save flow and MCP gateway tool calls (T-106, T-108, T-110)
// all go through `getInstallationOctokit()` — they never see the bearer
// nor talk to GitHub directly.
// ----------------------------------------------------------------------------

const CACHE_SAFETY_MS = 5 * 60 * 1000; // refresh 5 min before the token actually expires
const DEFAULT_TTL_MS = 50 * 60 * 1000;  // fallback if the endpoint doesn't return expires_at

type CacheEntry = {
  octokit: Octokit;
  expiresAtMs: number;
};

const cache = new Map<number, CacheEntry>();

export class GithubInstallationTokenError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GithubInstallationTokenError';
  }
}

type TokenSigningResponse = {
  token: string;
  expires_at: string | null;
  installation_id: number;
};

function resolveOlonjsApiBase(): string {
  return process.env.OLONJS_API_BASE?.trim() || 'https://app.olon.it/api/v1';
}

function resolveDeploymentToken(): string {
  const token = process.env.SAVE2REPO_DEPLOYMENT_TOKEN?.trim();
  if (!token) {
    throw new GithubInstallationTokenError(
      500,
      'ERR_DEPLOYMENT_TOKEN_MISSING',
      'SAVE2REPO_DEPLOYMENT_TOKEN env var is missing; the deployment cannot call the olonjs token-signing endpoint',
    );
  }
  return token;
}

async function mintInstallationToken(installationId: number): Promise<{ token: string; expiresAtMs: number }> {
  const apiBase = resolveOlonjsApiBase();
  const deploymentToken = resolveDeploymentToken();
  const url = `${apiBase.replace(/\/+$/, '')}/github/installation-token`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deploymentToken}`,
      },
      body: JSON.stringify({ installation_id: installationId }),
      // Short timeout via AbortSignal would be nice but Node fetch on older
      // runtimes doesn't always honour it — let Vercel's default apply.
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'olonjs backend unreachable';
    throw new GithubInstallationTokenError(
      503,
      'ERR_OLONJS_BACKEND_UNREACHABLE',
      `Could not reach the olonjs token-signing endpoint at ${url}: ${message}`,
    );
  }

  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = (await res.json()) as { error?: string; code?: string };
    } catch {
      // ignore parse failure — keep generic message
    }
    throw new GithubInstallationTokenError(
      res.status,
      body.code ?? 'ERR_TOKEN_SIGNING_REJECTED',
      body.error ?? `olonjs token-signing returned ${res.status}`,
    );
  }

  const data = (await res.json()) as TokenSigningResponse;
  const expiresAtMs = data.expires_at
    ? new Date(data.expires_at).getTime() - CACHE_SAFETY_MS
    : Date.now() + DEFAULT_TTL_MS;
  return { token: data.token, expiresAtMs };
}

/**
 * Return an Octokit instance authenticated as the buyer's installation of
 * the olonjs GitHub App. Cached per installation_id with a 5-minute safety
 * buffer before the token's stated expiry.
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const now = Date.now();
  const cached = cache.get(installationId);
  if (cached && cached.expiresAtMs > now) {
    return cached.octokit;
  }

  const { token, expiresAtMs } = await mintInstallationToken(installationId);
  const octokit = new Octokit({ auth: token });
  cache.set(installationId, { octokit, expiresAtMs });
  return octokit;
}

/** Drop the cached Octokit for a given installation (e.g. on token revoked). */
export function invalidateInstallationCache(installationId: number): void {
  cache.delete(installationId);
}
