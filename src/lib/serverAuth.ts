import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// ----------------------------------------------------------------------------
// save2repo is single-owner per ADR-002: every deployment has exactly one user
// (the buyer/owner) and N tenants that belong to that user. Multi-role +
// tenant_members semantics from the parent jsonpages-platform are removed.
//
// `assertOwner` is the canonical check used by Phase 1 routes. The legacy
// `assertTenantAccess` export is kept as a thin alias so the consumer routes
// already inherited from the parent compile unchanged; T-1xx will rename
// call sites and drop the alias.
// ----------------------------------------------------------------------------

type AuthSuccess = {
  user: User;
  accessToken: string;
  githubLogin: string | null;
};

type AuthError = {
  status: number;
  error: string;
};

export type TenantRole = 'owner';

export type TenantOwnerTenant = {
  id: string;
  owner_user_id: string;
  vercel_project_id: string | null;
};

type TenantOwnerSuccess = {
  tenantId: string;
  role: TenantRole;
  tenant: TenantOwnerTenant;
};

type TenantOwnerError = {
  status: number;
  error: string;
  code:
    | 'ERR_TENANT_NOT_FOUND'
    | 'ERR_TENANT_ACCESS_DENIED'
    | 'ERR_TENANT_ACCESS_LOOKUP_FAILED';
};

function parseBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function resolveGithubLogin(user: User): string | null {
  const metadata = user.user_metadata ?? {};
  const candidates = [
    metadata.user_name,
    metadata.preferred_username,
    metadata.login,
    metadata.name,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export async function requireRequestUser(
  req: NextRequest
): Promise<{ ok: true; data: AuthSuccess } | { ok: false; data: AuthError }> {
  const accessToken = parseBearerToken(req);
  if (!accessToken) {
    return { ok: false, data: { status: 401, error: 'Missing bearer token' } };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, data: { status: 500, error: 'Supabase auth is not configured' } };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return { ok: false, data: { status: 401, error: 'Invalid or expired session' } };
  }

  return {
    ok: true,
    data: {
      user: data.user,
      accessToken,
      githubLogin: resolveGithubLogin(data.user),
    },
  };
}

/**
 * Assert the request user is the owner of the requested tenant.
 * Single-owner only — no role hierarchy, no membership table.
 */
export async function assertOwner(params: {
  userId: string;
  tenantId: string;
}): Promise<{ ok: true; data: TenantOwnerSuccess } | { ok: false; data: TenantOwnerError }> {
  const { userId, tenantId } = params;
  const supabaseAdmin = getSupabaseAdmin();

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, owner_user_id, vercel_project_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError) {
    return {
      ok: false,
      data: {
        status: 500,
        error: 'Failed to resolve tenant access',
        code: 'ERR_TENANT_ACCESS_LOOKUP_FAILED',
      },
    };
  }

  if (!tenant?.id) {
    return {
      ok: false,
      data: {
        status: 404,
        error: 'Tenant not found',
        code: 'ERR_TENANT_NOT_FOUND',
      },
    };
  }

  if (tenant.owner_user_id !== userId) {
    return {
      ok: false,
      data: {
        status: 403,
        error: 'Access denied: not the owner of this tenant',
        code: 'ERR_TENANT_ACCESS_DENIED',
      },
    };
  }

  return { ok: true, data: { tenantId, role: 'owner', tenant: tenant as TenantOwnerTenant } };
}

/**
 * Legacy compatibility alias.
 * Parent jsonpages-platform code called `assertTenantAccess` with an optional
 * `requiredRole`. In save2repo there is only one role (`owner`); the param is
 * accepted and ignored. T-1xx renames call sites and drops this alias.
 */
export async function assertTenantAccess(params: {
  userId: string;
  tenantId: string;
  requiredRole?: TenantRole | 'admin' | 'editor';
}): ReturnType<typeof assertOwner> {
  void params.requiredRole;
  return assertOwner({ userId: params.userId, tenantId: params.tenantId });
}
