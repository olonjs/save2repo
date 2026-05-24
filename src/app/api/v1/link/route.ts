import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await req.json();
    const { licenseKey, repoOwner, repoName, slug, userId } = body;

    if (!licenseKey || !repoOwner || !repoName || !slug || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let tier = 'tier1';
    let storageLimit = 1073741824; // 1GB

    if (licenseKey.startsWith('TEST-')) {
      if (licenseKey.includes('BUSINESS')) {
        tier = 'tier2';
        storageLimit = 10737418240; 
      }
    } else {
      return NextResponse.json({ error: 'Invalid License Key' }, { status: 403 });
    }

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        owner_id: userId,
        name: slug,
        slug: slug,
        github_repo_owner: repoOwner,
        github_repo_name: repoName,
      })
      .select()
      .single();

    if (tenantError) {
      if (tenantError.code === '23505') {
        return NextResponse.json({ error: 'Project slug already exists.' }, { status: 409 });
      }
      throw tenantError;
    }

    const { error: licError } = await supabaseAdmin
      .from('licenses')
      .insert({
        tenant_id: tenant.id,
        license_key: licenseKey,
        plan_tier: tier,
        storage_limit_bytes: storageLimit,
        status: 'active'
      });

    if (licError) throw licError;

    return NextResponse.json({ 
      success: true, 
      message: 'Project linked successfully.',
      project: tenant
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}