import { NextRequest, NextResponse } from 'next/server';
import { App } from 'octokit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isSave2RoutesBetaEnabled } from '@/lib/saveFeatureFlags';
import { logSaveWarn, metricSave } from '@/lib/saveTelemetry';

// Forza il rendering dinamico per evitare tentativi di static analysis a build-time
export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  if (isSave2RoutesBetaEnabled()) {
    logSaveWarn('save.legacy_path_used', {
      route: '/api/v1/save',
      reason: 'save2routes_beta_enabled',
      correlationId: req.headers.get('x-correlation-id') ?? null,
    });
    metricSave('save_legacy_used', 1, { beta: true });
  }
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // Init GitHub App
    const app = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    });

    // 1. AUTENTICAZIONE
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }
    const apiKey = authHeader.split(' ')[1];

    // 2. LOOKUP TENANT
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('api_key', apiKey)
      .single();

    if (error || !tenant) {
      return NextResponse.json({ error: 'Invalid API Key' }, { status: 403, headers: corsHeaders });
    }

    if (!tenant.github_installation_id) {
       return NextResponse.json({ error: 'GitHub App not installed' }, { status: 400, headers: corsHeaders });
    }

    // 3. PARSE REQUEST
    const { path, content, message } = await req.json();
    if (!path || !content) {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400, headers: corsHeaders });
    }

    // 4. GITHUB COMMIT
    const octokit = await app.getInstallationOctokit(Number(tenant.github_installation_id));

    let sha;
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: tenant.github_repo_owner,
        repo: tenant.github_repo_name,
        path: path,
      });
      if (!Array.isArray(fileData)) {
        sha = fileData.sha;
      }
    } catch (e) {
      // File nuovo
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: tenant.github_repo_owner,
      repo: tenant.github_repo_name,
      path: path,
      message: message || `Update ${path} via JsonPages Cloud`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
      sha: sha,
    });

    return NextResponse.json({ success: true, message: 'Saved to GitHub' }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('Save Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}