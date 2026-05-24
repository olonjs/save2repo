import { NextRequest } from 'next/server';
import { App } from 'octokit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { refreshTenantPreview } from '@/lib/tenantPreview';
import { isSave2RoutesBetaEnabled } from '@/lib/saveFeatureFlags';
import { logSaveWarn, metricSave } from '@/lib/saveTelemetry';

export const dynamic = 'force-dynamic';

type StepId = 'commit' | 'push' | 'build' | 'live';
type StepStatus = 'running' | 'done';

interface SaveFileInput {
  path: string;
  content: unknown;
}

interface SaveRequestBody {
  path?: string;
  content?: unknown;
  files?: SaveFileInput[];
  message?: string;
  changedScopes?: Array<'page' | 'site'>;
}

interface TenantRecord {
  id: string;
  api_key: string;
  github_installation_id: string | null;
  github_repo_owner: string;
  github_repo_name: string;
  vercel_project_id: string | null;
}

interface VercelDeployment {
  id?: string;
  state?: string;
  readyState?: string;
  createdAt?: number;
  url?: string;
  alias?: string[];
  meta?: Record<string, string>;
}

interface VercelProjectResponse {
  id?: string;
  name?: string;
  link?: {
    repoId?: number | string;
  };
  error?: {
    message?: string;
  };
}

type GitHubOctokitLike = {
  rest: {
    repos: {
      get: (args: { owner: string; repo: string }) => Promise<{ data: { default_branch?: string } }>;
    };
    git: {
      getRef: (args: { owner: string; repo: string; ref: string }) => Promise<{ data: { object: { sha: string } } }>;
      getCommit: (args: { owner: string; repo: string; commit_sha: string }) => Promise<{ data: { tree: { sha: string } } }>;
      createBlob: (args: { owner: string; repo: string; content: string; encoding: 'base64' }) => Promise<{ data: { sha: string } }>;
      createTree: (args: {
        owner: string;
        repo: string;
        base_tree: string;
        tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>;
      }) => Promise<{ data: { sha: string } }>;
      createCommit: (args: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }) => Promise<{ data: { sha: string } }>;
      updateRef: (args: { owner: string; repo: string; ref: string; sha: string; force: boolean }) => Promise<unknown>;
    };
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SITE_CONFIG_PATH = 'src/data/config/site.json';

type SavePayloadMode = 'legacy' | 'bundle';

function hasOwnProperty(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeRepoPath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveSavePayload(body: SaveRequestBody): { files: SaveFileInput[]; mode: SavePayloadMode; changedScopes: Set<'page' | 'site'> } {
  const changedScopes = new Set<'page' | 'site'>(
    (Array.isArray(body.changedScopes) ? body.changedScopes : []).filter(
      (scope): scope is 'page' | 'site' => scope === 'page' || scope === 'site'
    )
  );

  if (Array.isArray(body.files) && body.files.length > 0) {
    const deduped = new Map<string, SaveFileInput>();
    for (const raw of body.files) {
      if (!raw || typeof raw.path !== 'string' || !raw.path.trim()) continue;
      const path = normalizeRepoPath(raw.path);
      deduped.set(path, { path, content: raw.content });
    }
    const files = Array.from(deduped.values());
    return { files, mode: 'bundle', changedScopes };
  }

  if (typeof body.path === 'string' && body.path.trim() && hasOwnProperty(body, 'content')) {
    const path = normalizeRepoPath(body.path);
    return { files: [{ path, content: body.content }], mode: 'legacy', changedScopes };
  }

  return { files: [], mode: 'legacy', changedScopes };
}

function includesSiteConfig(files: SaveFileInput[]): boolean {
  return files.some((file) => file.path.toLowerCase() === SITE_CONFIG_PATH);
}

function summarizeFileKinds(files: SaveFileInput[]): { pages: number; site: number; other: number } {
  let pages = 0;
  let site = 0;
  let other = 0;
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (lower === SITE_CONFIG_PATH) {
      site += 1;
      continue;
    }
    if (lower.startsWith('src/data/pages/') && lower.endsWith('.json')) {
      pages += 1;
      continue;
    }
    other += 1;
  }
  return { pages, site, other };
}

async function commitFilesAtomically(params: {
  octokit: GitHubOctokitLike;
  owner: string;
  repo: string;
  message: string;
  files: SaveFileInput[];
}): Promise<{ commitSha: string; branch: string }> {
  const { octokit, owner, repo, message, files } = params;
  const repoInfo = await octokit.rest.repos.get({ owner, repo });
  const branch = repoInfo.data.default_branch || 'main';

  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ref = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentCommitSha = ref.data.object.sha;

    const parentCommit = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: parentCommitSha,
    });
    const baseTreeSha = parentCommit.data.tree.sha;

    const treeItems = [] as Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>;
    for (const file of files) {
      const serialized = JSON.stringify(file.content, null, 2);
      const blob = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: Buffer.from(serialized, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      });
    }

    const tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    const commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.data.sha,
      parents: [parentCommitSha],
    });

    try {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.data.sha,
        force: false,
      });
      return { commitSha: commit.data.sha, branch };
    } catch (error) {
      if (attempt < maxAttempts - 1) continue;
      throw error;
    }
  }

  throw new Error('Atomic commit failed');
}

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toPublicUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

function toCanonicalLiveUrl(deployment: VercelDeployment, projectName?: string): string | null {
  const alias = Array.isArray(deployment.alias) && typeof deployment.alias[0] === 'string' ? deployment.alias[0] : null;
  const aliasUrl = toPublicUrl(alias);
  if (aliasUrl) return aliasUrl;

  if (typeof projectName === 'string' && projectName.trim()) {
    return `https://${projectName}.vercel.app`;
  }

  const directUrl = typeof deployment.url === 'string' ? deployment.url : null;
  const deploymentUrl = toPublicUrl(directUrl);
  if (deploymentUrl) return deploymentUrl;

  return null;
}

function getEffectiveDeploymentState(deployment: VercelDeployment): string {
  const rawState = deployment.readyState ?? deployment.state ?? 'QUEUED';
  return rawState.toUpperCase();
}

function getDeploymentStateTrace(deployment: VercelDeployment): string {
  return `readyState=${deployment.readyState ?? '-'}, state=${deployment.state ?? '-'} => effective=${getEffectiveDeploymentState(deployment)}`;
}

async function waitForDeploymentById(
  deploymentId: string,
  teamId: string,
  token: string,
  sendLog: (msg: string) => void
): Promise<VercelDeployment | null> {
  const maxAttempts = 90; // ~7.5 min
  const intervalMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const getRes = await fetch(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const deployment = (await getRes.json().catch(() => ({}))) as VercelDeployment & {
      error?: { message?: string };
    };
    if (!getRes.ok) {
      const msg = deployment.error?.message ?? `Vercel deployment fetch failed: ${getRes.status}`;
      throw new Error(msg);
    }

    const state = getEffectiveDeploymentState(deployment);
    sendLog(`Deployment status: ${getDeploymentStateTrace(deployment)}`);
    if (state === 'READY') return deployment;
    if (state === 'ERROR' || state === 'CANCELED' || state === 'FAILED') return deployment;

    sendLog(`Build in progress (${state})...`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  if (isSave2RoutesBetaEnabled()) {
    logSaveWarn('save-stream.legacy_path_used', {
      route: '/api/v1/save-stream',
      reason: 'save2routes_beta_enabled',
      correlationId: req.headers.get('x-correlation-id') ?? null,
    });
    metricSave('save_stream_legacy_used', 1, { beta: true });
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };
      const sendStep = (id: StepId, status: StepStatus, label?: string) => {
        send('step', label ? { id, status, label } : { id, status });
      };
      const sendLog = (stepId: StepId, message: string) => {
        send('log', { stepId, message });
      };
      const sendError = (message: string, code?: string, stepId?: StepId) => {
        send('error', {
          message,
          ...(code ? { code } : {}),
          ...(stepId ? { stepId } : {}),
        });
      };

      try {
        const correlationId = req.headers.get('x-correlation-id') ?? null;
        const authHeader = req.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          sendError('Unauthorized', 'ERR_UNAUTHORIZED');
          controller.close();
          return;
        }
        const apiKey = authHeader.split(' ')[1];

        const body = (await req.json()) as SaveRequestBody;
        const { files, mode, changedScopes } = resolveSavePayload(body);
        if (files.length === 0) {
          sendError('Missing save payload: provide (path/content) or files[]', 'ERR_BAD_REQUEST');
          controller.close();
          return;
        }
        if (changedScopes.has('site') && !includesSiteConfig(files)) {
          sendError('Global changes declared but src/data/config/site.json is missing in payload', 'ERR_SITE_CONFIG_REQUIRED');
          controller.close();
          return;
        }

        const supabaseAdmin = getSupabaseAdmin();
        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from('tenants')
          .select('id, api_key, github_installation_id, github_repo_owner, github_repo_name, vercel_project_id')
          .eq('api_key', apiKey)
          .single<TenantRecord>();

        if (tenantError || !tenant) {
          sendError('Invalid API Key', 'ERR_INVALID_API_KEY');
          controller.close();
          return;
        }

        if (!tenant.github_installation_id) {
          sendError('GitHub App not installed for tenant', 'ERR_GITHUB_INSTALLATION_MISSING');
          controller.close();
          return;
        }
        if (!tenant.vercel_project_id) {
          sendError('Missing Vercel project on tenant', 'ERR_VERCEL_PROJECT_MISSING');
          controller.close();
          return;
        }

        const vercelTeamId = process.env.VERCEL_TEAM_ID;
        const vercelToken = process.env.VERCEL_AUTH_TOKEN;
        if (!vercelTeamId || !vercelToken) {
          sendError('Vercel not configured', 'ERR_VERCEL_NOT_CONFIGURED');
          controller.close();
          return;
        }

        const app = new App({
          appId: process.env.GITHUB_APP_ID!,
          privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        });
        const octokit = (await app.getInstallationOctokit(Number(tenant.github_installation_id))) as unknown as GitHubOctokitLike;

        sendStep('commit', 'running', 'Committing changes');
        const summary = summarizeFileKinds(files);
        sendLog(
          'commit',
          `Preparing ${files.length} file(s) [mode=${mode}] (pages=${summary.pages}, site=${summary.site}, other=${summary.other}).`
        );
        const commitMessage =
          body.message?.trim() ||
          (files.length === 1
            ? `Update ${files[0].path} via JsonPages Cloud`
            : `Update ${files.length} files via JsonPages Cloud`);

        const atomicCommit = await commitFilesAtomically({
          octokit,
          owner: tenant.github_repo_owner,
          repo: tenant.github_repo_name,
          message: commitMessage,
          files,
        });
        const commitSha = atomicCommit.commitSha;
        if (!commitSha) {
          sendError('GitHub commit SHA missing in atomic save response.', 'ERR_GITHUB_COMMIT_SHA_MISSING', 'commit');
          controller.close();
          return;
        }
        sendLog('commit', `Committed ${files.length} file(s) atomically on ${atomicCommit.branch} (${commitSha.slice(0, 7)}).`);
        sendStep('commit', 'done');

        sendStep('push', 'running', 'Pushing to origin/main');
        sendLog('push', `Commit ${commitSha.slice(0, 7)} pushed to GitHub.`);
        sendStep('push', 'done');

        sendStep('build', 'running', 'Waiting Vercel build');
        sendLog('build', 'Resolving linked Vercel repository...');
        const projectRes = await fetch(
          `https://api.vercel.com/v9/projects/${encodeURIComponent(tenant.vercel_project_id)}?teamId=${encodeURIComponent(vercelTeamId)}`,
          {
            headers: { Authorization: `Bearer ${vercelToken}` },
          }
        );
        const projectData = (await projectRes.json().catch(() => ({}))) as VercelProjectResponse;
        if (!projectRes.ok) {
          sendError(
            projectData.error?.message ?? `Failed to fetch Vercel project (${projectRes.status}).`,
            'ERR_VERCEL_PROJECT_FETCH_FAILED',
            'build'
          );
          controller.close();
          return;
        }

        const repoIdRaw = projectData.link?.repoId;
        const repoId = typeof repoIdRaw === 'string' || typeof repoIdRaw === 'number' ? Number(repoIdRaw) : NaN;
        if (!Number.isFinite(repoId)) {
          sendError(
            'Vercel project is not linked to a Git repository (repoId missing).',
            'ERR_VERCEL_REPO_LINK_MISSING',
            'build'
          );
          controller.close();
          return;
        }

        sendLog('build', 'Triggering explicit deploy for current commit...');
        const deployBody: Record<string, unknown> = {
          project: tenant.vercel_project_id,
          gitSource: { type: 'github', ref: 'main', repoId },
          target: 'production',
        };
        if (typeof projectData.name === 'string' && projectData.name.trim()) {
          deployBody.name = projectData.name;
        }

        const triggerRes = await fetch(
          `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(vercelTeamId)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(deployBody),
          }
        );
        const triggerData = (await triggerRes.json().catch(() => ({}))) as VercelDeployment & {
          error?: { message?: string };
        };
        if (!triggerRes.ok || !triggerData.id) {
          sendError(
            triggerData.error?.message ?? `Failed to trigger deploy (${triggerRes.status}).`,
            'ERR_VERCEL_DEPLOY_TRIGGER_FAILED',
            'build'
          );
          controller.close();
          return;
        }

        const deployment = await waitForDeploymentById(triggerData.id, vercelTeamId, vercelToken, (message) =>
          sendLog('build', message)
        );

        if (!deployment) {
          sendError('Timed out while waiting for Vercel deployment.', 'ERR_VERCEL_DEPLOY_TIMEOUT', 'build');
          controller.close();
          return;
        }

        const state = getEffectiveDeploymentState(deployment);
        if (state === 'ERROR' || state === 'CANCELED' || state === 'FAILED') {
          sendLog('build', `Deployment ended with state ${state}.`);
          sendError(`Vercel deployment failed (${state}).`, 'ERR_VERCEL_DEPLOY_FAILED', 'build');
          controller.close();
          return;
        }
        if (state !== 'READY') {
          sendLog('build', `Unexpected terminal deployment state: ${getDeploymentStateTrace(deployment)}`);
          sendError(`Vercel deployment did not reach READY (state=${state}).`, 'ERR_VERCEL_DEPLOY_FAILED', 'build');
          controller.close();
          return;
        }

        sendStep('build', 'done');
        sendStep('live', 'running', 'Publishing');
        const deployUrl = toCanonicalLiveUrl(deployment, projectData.name);
        if (!deployUrl) {
          sendError('Deployment is READY but missing public URL.', 'ERR_VERCEL_DEPLOY_URL_MISSING', 'live');
          controller.close();
          return;
        }

        const { error: tenantUrlUpdateError } = await supabaseAdmin
          .from('tenants')
          .update({ vercel_url: deployUrl })
          .eq('id', tenant.id);
        if (tenantUrlUpdateError) {
          sendError('Failed to persist tenant live URL.', 'ERR_TENANT_URL_PERSIST_FAILED', 'live');
          controller.close();
          return;
        }

        const aliasRaw =
          Array.isArray(deployment.alias) && typeof deployment.alias[0] === 'string' ? deployment.alias[0] : null;
        const aliasPublicUrl = toPublicUrl(aliasRaw);

        void refreshTenantPreview({
          tenantId: tenant.id,
          tenantUrl: aliasPublicUrl ?? deployUrl,
          reason: 'publish',
          correlationId,
        }).catch((error) => {
          console.error('[save-stream] preview-refresh-failed', {
            tenantId: tenant.id,
            correlationId,
            message: error instanceof Error ? error.message : String(error),
          });
        });

        sendStep('live', 'done');
        send('done', { deployUrl, commitSha });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Save stream failed';
        console.error('[save-stream]', error);
        sendError(message, 'ERR_SAVE_STREAM_INTERNAL');
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'keep-alive',
    },
  });
}
