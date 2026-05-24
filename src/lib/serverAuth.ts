import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

type AuthSuccess = {
  user: User;
  accessToken: string;
  githubLogin: string | null;
};
//comment
type AuthError = {
  status: number;
  error: string;
};

export type TenantRole = 'owner' | 'admin' | 'editor';

type TenantAccessSuccess = {
  tenantId: string;
  role: TenantRole;
  tenant: {
    id: string;
    owner_id: string;
    vercel_project_id: string | null;
  };
};

type TenantAccessError = {
  status: number;
  error: string;
  code:
    | 'ERR_TENANT_NOT_FOUND'
    | 'ERR_TENANT_ACCESS_DENIED'
    | 'ERR_TENANT_ROLE_INSUFFICIENT'
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

function roleWeight(role: TenantRole): number {
  if (role === 'owner') return 3;
  if (role === 'admin') return 2;
  return 1;
}

function canSatisfyRole(currentRole: TenantRole, requiredRole: TenantRole): boolean {
  return roleWeight(currentRole) >= roleWeight(requiredRole);
}

export async function assertTenantAccess(params: {
  userId: string;
  tenantId: string;
  requiredRole?: TenantRole;
}): Promise<{ ok: true; data: TenantAccessSuccess } | { ok: false; data: TenantAccessError }> {
  const { userId, tenantId, requiredRole = 'editor' } = params;
  const supabaseAdmin = getSupabaseAdmin();

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, owner_id, vercel_project_id')
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

  if (tenant.owner_id === userId) {
    return { ok: true, data: { tenantId, role: 'owner', tenant } };
  }

  // Optional tenant_members support if the table exists in the environment.
  const membershipResult = await supabaseAdmin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (membershipResult.error && membershipResult.error.code !== '42P01') {
    return {
      ok: false,
      data: {
        status: 500,
        error: 'Failed to resolve tenant membership',
        code: 'ERR_TENANT_ACCESS_LOOKUP_FAILED',
      },
    };
  }

  const membershipRole = (membershipResult.data?.role ?? null) as TenantRole | null;
  if (!membershipRole || !['owner', 'admin', 'editor'].includes(membershipRole)) {
    return {
      ok: false,
      data: {
        status: 403,
        error: 'Access denied for tenant',
        code: 'ERR_TENANT_ACCESS_DENIED',
      },
    };
  }

  if (!canSatisfyRole(membershipRole, requiredRole)) {
    return {
      ok: false,
      data: {
        status: 403,
        error: 'Insufficient tenant role',
        code: 'ERR_TENANT_ROLE_INSUFFICIENT',
      },
    };
  }

  return { ok: true, data: { tenantId, role: membershipRole, tenant } };
}
