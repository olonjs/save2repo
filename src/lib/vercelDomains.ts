type RetryOptions = {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
};

export type VercelDomainError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  raw?: any;
};

const DEFAULT_RETRIES = Number(process.env.VERCEL_DOMAIN_RETRIES ?? 3);
const DEFAULT_TIMEOUT_MS = Number(process.env.VERCEL_DOMAIN_TIMEOUT_MS ?? 10_000);
const DEFAULT_BASE_DELAY_MS = Number(process.env.VERCEL_DOMAIN_RETRY_BASE_MS ?? 300);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapVercelError(status: number, data: any): VercelDomainError {
  const apiCode = data?.error?.code ?? data?.code ?? 'VERCEL_ERROR';
  const message = data?.error?.message ?? data?.message ?? `Vercel API failed with ${status}`;
  const loweredMessage = String(message).toLowerCase();
  const loweredCode = String(apiCode).toLowerCase();
  const conflictDetected =
    status === 409 ||
    loweredCode.includes('domain_taken') ||
    loweredCode.includes('forbidden_domain') ||
    loweredMessage.includes('already in use') ||
    loweredMessage.includes('already assigned');

  if (conflictDetected) {
    return {
      status: 409,
      code: 'ERR_DOMAIN_CONFLICT',
      message: 'Domain is already in use on another project',
      retryable: false,
      raw: data,
    };
  }

  if (status === 429) {
    return {
      status,
      code: 'ERR_VERCEL_RATE_LIMITED',
      message,
      retryable: true,
      raw: data,
    };
  }

  if (status >= 500) {
    return {
      status,
      code: 'ERR_VERCEL_UPSTREAM_5XX',
      message,
      retryable: true,
      raw: data,
    };
  }

  return {
    status,
    code: status >= 400 && status < 500 ? 'ERR_VERCEL_UPSTREAM_4XX' : 'ERR_VERCEL_UPSTREAM',
    message,
    retryable: false,
    raw: data,
  };
}

async function vercelFetch(path: string, init: RequestInit, retryOptions: RetryOptions = {}) {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) {
    throw <VercelDomainError>{
      status: 500,
      code: 'ERR_VERCEL_CONFIG_MISSING',
      message: 'Vercel credentials are not configured',
      retryable: false,
    };
  }

  const retries = retryOptions.retries ?? DEFAULT_RETRIES;
  const timeoutMs = retryOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const queryJoiner = path.includes('?') ? '&' : '?';
  const url = `https://api.vercel.com${path}${queryJoiner}teamId=${encodeURIComponent(teamId)}`;

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const mappedError = mapVercelError(response.status, data);
        if (mappedError.retryable && attempt < retries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          attempt += 1;
          continue;
        }
        throw mappedError;
      }
      return data;
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      const mappedTimeout = timedOut
        ? <VercelDomainError>{
            status: 504,
            code: 'ERR_VERCEL_TIMEOUT',
            message: `Vercel request timed out after ${timeoutMs}ms`,
            retryable: true,
          }
        : (error as VercelDomainError);

      if (mappedTimeout.retryable && attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }
      throw mappedTimeout;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw <VercelDomainError>{
    status: 500,
    code: 'ERR_VERCEL_RETRY_EXHAUSTED',
    message: 'Vercel request exhausted retries',
    retryable: false,
  };
}

export async function vercelAddDomain(projectId: string, domain: string) {
  return vercelFetch(`/v10/projects/${encodeURIComponent(projectId)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  });
}

export async function vercelGetDomainStatus(projectId: string, domain: string) {
  return vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, {
    method: 'GET',
  });
}

export async function vercelGetDomainConfig(projectId: string, domain: string) {
  return vercelFetch(`/v6/domains/${encodeURIComponent(domain)}/config?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
  });
}

export async function vercelVerifyDomain(projectId: string, domain: string) {
  return vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}/verify`, {
    method: 'POST',
  });
}

export async function vercelRemoveDomain(projectId: string, domain: string) {
  return vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });
}
