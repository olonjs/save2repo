import { NextRequest, NextResponse } from 'next/server';
import { App } from 'octokit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { randomUUID } from 'crypto';
import { ensureEdgeConfigId } from '@/lib/saveEdgeConfig';
import { isSave2RoutesBetaEnabled } from '@/lib/saveFeatureFlags';
import { derivePublicVercelUrl } from '@/lib/vercelUrls';

export const dynamic = 'force-dynamic';

const TEMPLATE_ORG = 'olonjs';
const JSONPAGES_CLOUD_URL = process.env.JSONPAGES_CLOUD_URL || 'https://app.olon.it/api/v1';

/** Error codes for frontend (Dopa) */
const ERR = {
  GITHUB_NAME_TAKEN: 'ERR_GITHUB_NAME_TAKEN',
  GITHUB_TEMPLATE_FORBIDDEN: 'ERR_GITHUB_TEMPLATE_FORBIDDEN',
  GITHUB_FAILED: 'ERR_GITHUB_FAILED',
  VERCEL_FAILED: 'ERR_VERCEL_FAILED',
  VERCEL_LIMIT_REACHED: 'ERR_VERCEL_LIMIT_REACHED',
  VERCEL_ENV_FAILED: 'ERR_VERCEL_ENV_FAILED',
  SUPABASE_FAILED: 'ERR_SUPABASE_FAILED',
  INVALID_TEMPLATE_OWNER: 'ERR_INVALID_TEMPLATE_OWNER',
  TEMPLATE_NOT_FOUND: 'ERR_TEMPLATE_NOT_FOUND',
  INVALID_TEMPLATE_INPUT: 'ERR_INVALID_TEMPLATE_INPUT',
} as const;

type SagaState = {
  githubRepoId?: number;
  githubFullName?: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  vercelEdgeConfigId?: string;
};

/**
 * POST /api/v1/tenants/create
 * Saga: Crea repo da template → progetto Vercel → env vars → record Supabase.
 * Body: { installationId, userId, slug, ownerLogin, accountType?: 'User' | 'Organization' }
 * Per installazioni su Organization si usa createInOrg per evitare 403.
 */
export async function POST(req: NextRequest) {
  const state: SagaState = {};

  try {
    const body = await req.json();
    const { installationId, userId, slug, ownerLogin, accountType, templateRepo } = body as {
      installationId?: string | number;
      userId?: string;
      slug?: string;
      ownerLogin?: string;
      accountType?: 'User' | 'Organization';
      templateRepo?: { owner?: string; repo?: string };
    };

    if (!installationId || !userId || !slug || !ownerLogin) {
      return NextResponse.json(
        { error: 'Missing installationId, userId, slug or ownerLogin', code: 'ERR_BAD_REQUEST' },
        { status: 400 }
      );
    }

    if (!templateRepo?.owner || !templateRepo?.repo) {
      return NextResponse.json(
        { error: 'Missing templateRepo.owner or templateRepo.repo', code: ERR.INVALID_TEMPLATE_INPUT },
        { status: 400 }
      );
    }

    if (templateRepo.owner !== TEMPLATE_ORG) {
      return NextResponse.json(
        { error: `Template owner must be '${TEMPLATE_ORG}'`, code: ERR.INVALID_TEMPLATE_OWNER },
        { status: 400 }
      );
    }

    const templateOwner = templateRepo.owner;
    const templateRepoName = templateRepo.repo;

    const projectSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!projectSlug) {
      return NextResponse.json(
        { error: 'Invalid slug', code: 'ERR_BAD_REQUEST' },
        { status: 400 }
      );
    }

    const apiKey = randomUUID();
    const supabase = getSupabaseAdmin();
    const teamId = process.env.VERCEL_TEAM_ID;
    const token = process.env.VERCEL_AUTH_TOKEN;

    if (!teamId || !token) {
      return NextResponse.json(
        { error: 'Vercel not configured', code: 'ERR_VERCEL_CONFIG' },
        { status: 500 }
      );
    }

    // ─── Phase 1: GitHub – create repo from template (Installation ID = utente di destinazione) ─
    let githubStep = 'init';
    try {
      const app = new App({
        appId: process.env.GITHUB_APP_ID!,
        privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      });
      // Octokit dell'installazione scelta dall'utente (non token generico App)
      const octokit = await app.getInstallationOctokit(Number(installationId));

      githubStep = 'validate_template';
      const templateInfo = await octokit.rest.repos
        .get({ owner: templateOwner, repo: templateRepoName })
        .then((r) => r.data)
        .catch(() => null);
      if (!templateInfo?.is_template) {
        return NextResponse.json(
          {
            error: `Template ${templateOwner}/${templateRepoName} not found or is not a template repository`,
            code: ERR.TEMPLATE_NOT_FOUND,
          },
          { status: 400 }
        );
      }

      githubStep = 'create_repo';
      const description = 'Sovereign site powered by JsonPages';
      let repo: { id: number; full_name?: string; owner?: { login?: string }; name?: string };

      // Prova prima createUsingTemplate (owner = destinatario: g-serio o org)
      const templateResult = await octokit.rest.repos
        .createUsingTemplate({
          template_owner: templateOwner,
          template_repo: templateRepoName,
          owner: ownerLogin,
          name: projectSlug,
          description,
          private: true,
        })
        .then((res) => ({ data: res.data, ok: true as const }))
        .catch((err: unknown) => {
          const status = (err as { status?: number })?.status;
          if (status === 403 || status === 404) return { ok: false as const, status };
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('name already exists') || msg.includes('422')) {
            throw Object.assign(new Error('Repository name already exists'), { code: ERR.GITHUB_NAME_TAKEN });
          }
          throw err;
        });

      if (templateResult.ok) {
        repo = templateResult.data;
      } else {
        // Fallback: create repo vuoto + copia via Git Data API (per quando l'App non può usare /generate)
        const repoPayload = { name: projectSlug, description, private: true };
        const createRepo =
          accountType === 'Organization'
            ? () => octokit.rest.repos.createInOrg({ org: ownerLogin, ...repoPayload })
            : () => octokit.rest.repos.createForAuthenticatedUser(repoPayload);
        const created = await createRepo().catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('name already exists') || msg.includes('422')) {
            throw Object.assign(new Error('Repository name already exists'), { code: ERR.GITHUB_NAME_TAKEN });
          }
          throw e;
        });
        repo = created.data;

        const defaultBranch = templateInfo.default_branch ?? 'main';
        const ref = await octokit.rest.git.getRef({ owner: templateOwner, repo: templateRepoName, ref: `heads/${defaultBranch}` });
        const commitSha = ref.data.object.sha;
        const commit = await octokit.rest.git.getCommit({ owner: templateOwner, repo: templateRepoName, commit_sha: commitSha });
        const treeSha = commit.data.tree.sha;
        const { data: treeData } = await octokit.rest.git.getTree({
          owner: templateOwner,
          repo: templateRepoName,
          tree_sha: treeSha,
          recursive: '1',
        });

        const blobs = (treeData.tree || []).filter((n: { type?: string }) => n.type === 'blob') as { path?: string; sha?: string; mode?: string }[];
        const newRepoOwner = repo.owner?.login ?? ownerLogin;
        const newRepoName = repo.name!;

        githubStep = 'copy_blobs';
        const newTreeItems: { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string }[] = [];
        for (const blob of blobs) {
          if (!blob.path || !blob.sha) continue;
          const { data: blobData } = await octokit.rest.git.getBlob({ owner: templateOwner, repo: templateRepoName, file_sha: blob.sha });
          const { data: newBlob } = await octokit.rest.git.createBlob({
            owner: newRepoOwner,
            repo: newRepoName,
            content: blobData.content,
            encoding: (blobData.encoding as 'utf-8' | 'base64') || 'base64',
          });
          const mode = (blob.mode === '100755' ? '100755' : '100644') as '100644' | '100755';
          newTreeItems.push({ path: blob.path, mode, type: 'blob', sha: newBlob.sha });
        }

        githubStep = 'create_tree_commit';
        const { data: newTree } = await octokit.rest.git.createTree({
          owner: newRepoOwner,
          repo: newRepoName,
          tree: newTreeItems,
        });
        const { data: newCommit } = await octokit.rest.git.createCommit({
          owner: newRepoOwner,
          repo: newRepoName,
          message: 'Initial commit from JsonPages template',
          tree: newTree.sha,
          parents: [],
        });
        const refName = `refs/heads/${defaultBranch}`;
        try {
          await octokit.rest.git.createRef({ owner: newRepoOwner, repo: newRepoName, ref: refName, sha: newCommit.sha });
        } catch (refErr: unknown) {
          const refMsg = refErr instanceof Error ? refErr.message : String(refErr);
          if (refMsg.includes('Reference already exists') || refMsg.includes('already exists')) {
            await octokit.rest.git.updateRef({ owner: newRepoOwner, repo: newRepoName, ref: refName, sha: newCommit.sha, force: true });
          } else {
            throw refErr;
          }
        }
      }

      state.githubRepoId = repo.id;
      state.githubFullName = repo.full_name;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      if (code === ERR.GITHUB_NAME_TAKEN || msg.includes('name already exists') || msg.includes('422')) {
        return NextResponse.json(
          { error: 'Repository name already exists', code: ERR.GITHUB_NAME_TAKEN },
          { status: 409 }
        );
      }
      if (msg.includes('Resource not accessible by integration') || msg.includes('403')) {
        const stepLabel: Record<string, string> = {
          validate_template: `lettura template ${templateOwner}/${templateRepoName}`,
          create_repo: 'creazione nuovo repository',
          copy_blobs: 'copia file nel nuovo repo',
          create_tree_commit: 'commit iniziale',
        };
        return NextResponse.json(
          {
            error: `GitHub App: 403 al passo "${stepLabel[githubStep] ?? githubStep}". Controlla permessi (Repository creation + Contents read/write) e installazione.`,
            code: ERR.GITHUB_TEMPLATE_FORBIDDEN,
            step: githubStep,
            details: msg,
          },
          { status: 403 }
        );
      }
      console.error('[tenants/create] GitHub', e);
      return NextResponse.json(
        { error: msg || 'GitHub failed', code: ERR.GITHUB_FAILED, step: githubStep },
        { status: 502 }
      );
    }

    // ─── Phase 2: Vercel – create project ────────────────────────────────
    try {
      const res = await fetch(
        `https://api.vercel.com/v9/projects?teamId=${encodeURIComponent(teamId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: projectSlug,
            framework: 'vite',
            gitRepository: {
              type: 'github',
              repo: state.githubFullName!,
            },
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 || data?.error?.code === 'LIMIT_REACHED') {
          return NextResponse.json(
            { error: data?.error?.message || 'Vercel limit reached', code: ERR.VERCEL_LIMIT_REACHED },
            { status: 402 }
          );
        }
        throw new Error(data?.error?.message || `Vercel ${res.status}`);
      }

      state.vercelProjectId = data.id;
      if (typeof data?.name === 'string' && data.name.trim()) {
        state.vercelProjectName = data.name.trim();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tenants/create] Vercel', e);
      return NextResponse.json(
        { error: msg || 'Vercel failed', code: ERR.VERCEL_FAILED },
        { status: 502 }
      );
    }

    // ─── Phase 3: Vercel – env vars ─────────────────────────────────────
    if (isSave2RoutesBetaEnabled()) {
      try {
        state.vercelEdgeConfigId = await ensureEdgeConfigId({
          existingId: null,
          tenantSlug: projectSlug,
        });
      } catch (e: unknown) {
        return NextResponse.json(
          { error: (e instanceof Error ? e.message : String(e)) || 'Edge config provisioning failed', code: ERR.VERCEL_ENV_FAILED },
          { status: 502 }
        );
      }
    }

    const envs = [
      { key: 'VITE_JSONPAGES_CLOUD_URL', value: JSONPAGES_CLOUD_URL, type: 'encrypted' as const, target: ['production', 'preview'] as const },
      { key: 'VITE_JSONPAGES_API_KEY', value: apiKey, type: 'encrypted' as const, target: ['production', 'preview'] as const },
    ];

    for (const env of envs) {
      try {
        const res = await fetch(
          `https://api.vercel.com/v10/projects/${state.vercelProjectId}/env?teamId=${encodeURIComponent(teamId)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: env.key,
              value: env.value,
              type: env.type,
              target: env.target,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err?.error?.message || res.statusText);
        }
      } catch (e: unknown) {
        console.error('[tenants/create] Vercel env', env.key, e);
        return NextResponse.json(
          { error: (e instanceof Error ? e.message : String(e)) || 'Env failed', code: ERR.VERCEL_ENV_FAILED },
          { status: 502 }
        );
      }
    }

    // ─── Phase 4: Supabase – persist tenant ───────────────────────────────
    let tenantId: string;
    try {
      const { data: tenant, error } = await supabase
        .from('tenants')
        .insert({
          owner_id: userId,
          name: projectSlug,
          slug: projectSlug,
          github_repo_owner: ownerLogin,
          github_repo_name: projectSlug,
          github_repo_id: state.githubRepoId,
          github_installation_id: String(installationId),
          vercel_project_id: state.vercelProjectId,
          vercel_edge_config_id: state.vercelEdgeConfigId ?? null,
          vercel_public_url: derivePublicVercelUrl(state.vercelProjectName ?? projectSlug),
          forms_git_storage_enabled: true,
          forms_storage_policy: 'git_plus_db',
          api_key: apiKey,
          status: 'provisioned',
        })
        .select('id')
        .single();

      if (error) throw error;
      if (!tenant?.id) throw new Error('Insert did not return id');
      tenantId = tenant.id;
    } catch (e: unknown) {
      console.error('[tenants/create] Supabase', e);
      return NextResponse.json(
        { error: (e instanceof Error ? e.message : String(e)) || 'Database failed', code: ERR.SUPABASE_FAILED },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tenant: {
        id: tenantId,
        slug: projectSlug,
        name: projectSlug,
        github_repo_id: state.githubRepoId,
        github_repo_name: state.githubFullName,
        vercel_project_id: state.vercelProjectId,
        vercel_edge_config_id: state.vercelEdgeConfigId ?? null,
        status: 'provisioned',
      },
      api_key: apiKey,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[tenants/create]', error);
    return NextResponse.json({ error: message, code: 'ERR_UNKNOWN' }, { status: 500 });
  }
}
