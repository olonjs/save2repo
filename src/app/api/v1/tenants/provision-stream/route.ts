import { NextRequest } from 'next/server';
import { App } from 'octokit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { reconcileTenantPreviews, refreshTenantPreview } from '@/lib/tenantPreview';
import { randomUUID, randomInt, generateKeyPairSync, createPublicKey } from 'crypto';
import { ensureEdgeConfigId } from '@/lib/saveEdgeConfig';
import { isSave2RoutesBetaEnabled } from '@/lib/saveFeatureFlags';
import { mapRepoJsonFilesToEdgeEntries } from '@/lib/saveRepoToEdgeMap';
import { replaceTenantContent, type TenantContentPayload } from '@/lib/tenantContentStore';
import { derivePublicVercelUrl } from '@/lib/vercelUrls';
import { generateTenantStaticFiles, uploadTenantStaticFiles } from '@/lib/tenantStaticFiles';

export const dynamic = 'force-dynamic';

const TEMPLATE_ORG = 'olonjs';
const JSONPAGES_CLOUD_URL = process.env.JSONPAGES_CLOUD_URL || 'https://app.olon.it/api/v1';

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

type TemplateSource = {
  type: 'template';
  slug: string;
  ownerLogin: string;
  accountType?: 'User' | 'Organization';
  templateRepo: { owner: string; repo: string };
};

type RepositoryInput = {
  id?: number | string | null;
  name?: string;
  full_name?: string;
  owner?: { login?: string };
  private?: boolean;
};

type RepositorySource = {
  type: 'repository';
  repo: RepositoryInput;
  ownerLogin?: string;
};

type ProvisionSource = TemplateSource | RepositorySource;

interface ProvisionRequestBody {
  installationId: string | number;
  userId: string;
  entitlementCorrelationId?: string;
  entitlementPlanCode?: 'starter' | 'pro' | 'business';
  source: ProvisionSource;
}

type SagaState = {
  githubRepoId?: number;
  githubFullName?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  vercelProjectId?: string;
  vercelRepoId?: number;
  vercelEdgeConfigId?: string;
  adminPrivateKeyPem?: string;
  adminPublicKeyPem?: string;
};

type RepoContentFile = {
  path?: string;
  type?: string;
  sha?: string;
  content?: string;
  encoding?: string;
};

type GitHubOctokitLike = {
  rest: {
    repos: {
      getContent: (params: { owner: string; repo: string; path: string }) => Promise<{ data: unknown }>;
    };
  };
};

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function extractRepoName(repo: RepositoryInput): string {
  const byName = typeof repo.name === 'string' ? repo.name : '';
  if (byName) return byName;
  const fullName = typeof repo.full_name === 'string' ? repo.full_name : '';
  const splitName = fullName.split('/')[1];
  return splitName || 'unknown';
}

function extractRepoOwner(repo: RepositoryInput, fallbackOwner?: string): string {
  if (fallbackOwner) return fallbackOwner;
  const ownerFromRepo = repo.owner?.login;
  if (ownerFromRepo) return ownerFromRepo;
  const fullName = typeof repo.full_name === 'string' ? repo.full_name : '';
  const splitOwner = fullName.split('/')[0];
  return splitOwner || 'unknown';
}

async function getRepoJsonFile(
  octokit: GitHubOctokitLike,
  owner: string,
  repo: string,
  path: string
): Promise<unknown> {
  const response = await octokit.rest.repos.getContent({ owner, repo, path });
  if (Array.isArray(response.data)) {
    throw new Error(`Expected file but found directory at ${path}`);
  }
  const data = response.data as RepoContentFile;
  const raw =
    typeof data.content === 'string'
      ? Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
      : '';
  return JSON.parse(raw) as unknown;
}

async function listRepoPagePaths(
  octokit: GitHubOctokitLike,
  owner: string,
  repo: string
): Promise<string[]> {
  const response = await octokit.rest.repos.getContent({ owner, repo, path: 'src/data/pages' });
  if (!Array.isArray(response.data)) return [];
  return response.data
    .filter((entry) => entry.type === 'file' && typeof entry.path === 'string' && entry.path.endsWith('.json'))
    .map((entry) => entry.path as string);
}

type DeployReadyResult = {
  deploymentUrl: string;
  publicUrl: string | null;
};

async function waitForDeployReady(
  deploymentId: string,
  teamId: string,
  token: string,
  sendLog: (msg: string) => void
): Promise<DeployReadyResult | null> {
  const maxAttempts = 60;
  const intervalMs = 5000;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const deployment = await res.json().catch(() => ({}));
    if (!res.ok) {
      sendLog(`Deploy fetch failed (${deployment?.error?.message ?? res.status})`);
      return null;
    }

    const rawState = (deployment.readyState ?? deployment.state ?? '').toUpperCase();

    if (rawState === 'READY') {
      const rawUrl = typeof deployment.url === 'string' ? deployment.url : '';
      const deploymentUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
      const rawAlias = Array.isArray(deployment.alias)
        ? deployment.alias.find((a: unknown) => typeof a === 'string')
        : null;
      const publicUrl =
        typeof rawAlias === 'string'
          ? rawAlias.startsWith('http') ? rawAlias : `https://${rawAlias}`
          : null;
      return { deploymentUrl, publicUrl };
    }

    if (rawState === 'ERROR' || rawState === 'CANCELED' || rawState === 'FAILED') {
      sendLog(`Deploy in stato: ${rawState}`);
      return null;
    }

    sendLog(`Build in corso (${rawState})...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}

async function vercelProjectNameExists(teamId: string, token: string, projectName: string): Promise<boolean> {
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectName)}?teamId=${encodeURIComponent(teamId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.ok;
}

const MAX_VERCEL_NAME_ATTEMPTS = 10;

function buildRetryCandidate(baseName: string): string {
  return `${baseName}-json${randomInt(10000, 100000)}`;
}

async function findFreeVercelName(
  teamId: string,
  token: string,
  baseName: string,
  sendLog: (msg: string) => void
): Promise<{ projectName: string; attemptCount: number }> {
  for (let attempt = 0; attempt < MAX_VERCEL_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? baseName : buildRetryCandidate(baseName);
    const exists = await vercelProjectNameExists(teamId, token, candidate);
    if (!exists) {
      if (attempt > 0) sendLog(`Nome "${baseName}" occupato, uso "${candidate}" (tentativo ${attempt + 1}).`);
      return { projectName: candidate, attemptCount: attempt + 1 };
    }
    if (attempt === 0) sendLog(`Nome "${baseName}" occupato su Vercel, applico suffix policy enterprise.`);
  }
  throw new Error(`Impossibile trovare un nome libero su Vercel dopo ${MAX_VERCEL_NAME_ATTEMPTS} tentativi.`);
}

async function deleteVercelProjectBestEffort(params: {
  teamId: string;
  token: string;
  projectId?: string;
  requestId: string;
  sendLog: (msg: string) => void;
}): Promise<void> {
  const { teamId, token, projectId, requestId, sendLog } = params;
  if (!projectId) return;

  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok || res.status === 404) {
      sendLog('Cleanup Vercel completato: progetto temporaneo rimosso.');
      return;
    }
    const payload = await res.json().catch(() => ({}));
    const message = payload?.error?.message || `HTTP ${res.status}`;
    console.warn('[tenants/provision-stream] vercel-cleanup-failed', {
      requestId,
      projectId,
      status: res.status,
      message,
    });
    sendLog(`Cleanup Vercel non completato (${message}). Verifica dashboard Vercel.`);
  } catch (error) {
    console.warn('[tenants/provision-stream] vercel-cleanup-failed', {
      requestId,
      projectId,
      message: error instanceof Error ? error.message : String(error),
    });
    sendLog('Cleanup Vercel non completato. Verifica dashboard Vercel.');
  }
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const requestId = req.headers.get('x-vercel-id') ?? req.headers.get('x-request-id') ?? randomUUID();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };
      const sendError = ({
        message,
        code,
        stepId,
        provider,
        providerStatus,
      }: {
        message: string;
        code?: string;
        stepId?: 'repo' | 'vercel' | 'env' | 'deploy' | 'db';
        provider?: 'github' | 'vercel' | 'supabase' | 'system';
        providerStatus?: number | string;
      }) => {
        const payload = {
          message,
          code: code ?? 'ERR_PROVISION_STREAM',
          stepId: stepId ?? 'repo',
          provider: provider ?? 'system',
          requestId,
          providerStatus: providerStatus ?? null,
        };
        console.error('[tenants/provision-stream] terminal-error', payload);
        send('error', payload);
      };

      try {
        const body = (await req.json()) as ProvisionRequestBody;
        const { installationId, userId, source, entitlementCorrelationId, entitlementPlanCode } = body;

        if (!installationId || !userId || !source?.type) {
          sendError({ message: 'Missing installationId, userId or source', code: 'ERR_PROVISION_INVALID_INPUT', stepId: 'repo' });
          controller.close();
          return;
        }

        const apiKey = randomUUID();
        const supabase = getSupabaseAdmin();
        const teamId = process.env.VERCEL_TEAM_ID;
        const token = process.env.VERCEL_AUTH_TOKEN;
        if (!teamId || !token) {
          sendError({ message: 'Vercel not configured', code: 'ERR_VERCEL_NOT_CONFIGURED', stepId: 'vercel', provider: 'vercel' });
          controller.close();
          return;
        }

        const state: SagaState = {};
        let projectSlug = '';
        let formsGitStorageEnabled = true;
        let formsStoragePolicy = 'git_plus_db';

        send('step', {
          id: 'repo',
          status: 'running',
          label: source.type === 'template' ? 'Creazione repository' : 'Collegamento repository',
        });

        if (source.type === 'template') {
          if (!source.slug || !source.ownerLogin) {
            sendError({ message: 'Missing template slug or ownerLogin', code: 'ERR_TEMPLATE_INPUT_INVALID', stepId: 'repo' });
            controller.close();
            return;
          }

          if (!source.templateRepo?.owner || !source.templateRepo?.repo) {
            sendError({ message: 'Missing templateRepo.owner or templateRepo.repo', code: ERR.INVALID_TEMPLATE_INPUT, stepId: 'repo' });
            controller.close();
            return;
          }

          if (source.templateRepo.owner !== TEMPLATE_ORG) {
            sendError({ message: `Template owner must be '${TEMPLATE_ORG}'`, code: ERR.INVALID_TEMPLATE_OWNER, stepId: 'repo' });
            controller.close();
            return;
          }

          projectSlug = normalizeSlug(source.slug);
          if (!projectSlug) {
            sendError({ message: 'Invalid slug', code: 'ERR_TEMPLATE_SLUG_INVALID', stepId: 'repo' });
            controller.close();
            return;
          }

          send('log', { stepId: 'repo', message: 'GitHub: creazione repo da template...' });
          try {
            const app = new App({
              appId: process.env.GITHUB_APP_ID!,
              privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
            });
            const octokit = await app.getInstallationOctokit(Number(installationId));
            const description = 'Sovereign site powered by JsonPages';
            let repo: { id: number; full_name?: string; owner?: { login?: string }; name?: string };

            const templateOwner = source.templateRepo.owner;
            const templateRepo = source.templateRepo.repo;

            const templateInfo = await octokit.rest.repos
              .get({ owner: templateOwner, repo: templateRepo })
              .then((r) => r.data)
              .catch(() => null);
            if (!templateInfo?.is_template) {
              sendError({
                message: `Template ${templateOwner}/${templateRepo} not found or is not a template repository`,
                code: ERR.TEMPLATE_NOT_FOUND,
                stepId: 'repo',
                provider: 'github',
              });
              controller.close();
              return;
            }

            const templateResult = await octokit.rest.repos
              .createUsingTemplate({
                template_owner: templateOwner,
                template_repo: templateRepo,
                owner: source.ownerLogin,
                name: projectSlug,
                description,
                private: true,
              })
              .then((res) => ({ data: res.data, ok: true as const }))
              .catch((err: unknown) => {
                const status = (err as { status?: number })?.status;
                if (status === 403 || status === 404) return { ok: false as const };
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('name already exists') || msg.includes('422')) {
                  throw Object.assign(new Error('Repository name already exists'), { code: ERR.GITHUB_NAME_TAKEN });
                }
                throw err;
              });

            if (templateResult.ok) {
              repo = templateResult.data;
              send('log', { stepId: 'repo', message: 'Repo creato da template' });
            } else {
              send('log', { stepId: 'repo', message: 'Template non disponibile, copia via Git Data API...' });
              const repoPayload = { name: projectSlug, description, private: true };
              const createRepo =
                source.accountType === 'Organization'
                  ? () => octokit.rest.repos.createInOrg({ org: source.ownerLogin, ...repoPayload })
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
              const ref = await octokit.rest.git.getRef({ owner: templateOwner, repo: templateRepo, ref: `heads/${defaultBranch}` });
              const commit = await octokit.rest.git.getCommit({ owner: templateOwner, repo: templateRepo, commit_sha: ref.data.object.sha });
              const { data: treeData } = await octokit.rest.git.getTree({
                owner: templateOwner,
                repo: templateRepo,
                tree_sha: commit.data.tree.sha,
                recursive: '1',
              });

              const blobs = (treeData.tree || []).filter((n: { type?: string }) => n.type === 'blob') as {
                path?: string;
                sha?: string;
                mode?: string;
              }[];
              const newRepoOwner = repo.owner?.login ?? source.ownerLogin;
              const newRepoName = repo.name!;
              const newTreeItems: { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string }[] = [];
              for (const blob of blobs) {
                if (!blob.path || !blob.sha) continue;
                const { data: blobData } = await octokit.rest.git.getBlob({
                  owner: templateOwner,
                  repo: templateRepo,
                  file_sha: blob.sha,
                });
                const { data: newBlob } = await octokit.rest.git.createBlob({
                  owner: newRepoOwner,
                  repo: newRepoName,
                  content: blobData.content,
                  encoding: (blobData.encoding as 'utf-8' | 'base64') || 'base64',
                });
                const mode = (blob.mode === '100755' ? '100755' : '100644') as '100644' | '100755';
                newTreeItems.push({ path: blob.path, mode, type: 'blob', sha: newBlob.sha });
              }
              const { data: newTree } = await octokit.rest.git.createTree({ owner: newRepoOwner, repo: newRepoName, tree: newTreeItems });
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
            state.githubRepoOwner = source.ownerLogin;
            state.githubRepoName = projectSlug;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const code = (e as { code?: string })?.code;
            if (code === ERR.GITHUB_NAME_TAKEN || msg.includes('name already exists') || msg.includes('422')) {
              sendError({ message: 'Repository name already exists', code: ERR.GITHUB_NAME_TAKEN, stepId: 'repo', provider: 'github' });
            } else if (msg.includes('Resource not accessible by integration') || msg.includes('403')) {
              sendError({ message: msg, code: ERR.GITHUB_TEMPLATE_FORBIDDEN, stepId: 'repo', provider: 'github' });
            } else {
              sendError({ message: msg || 'GitHub failed', code: ERR.GITHUB_FAILED, stepId: 'repo', provider: 'github' });
            }
            controller.close();
            return;
          }
        } else {
          if (!source.repo) {
            sendError({ message: 'Missing repository payload', code: 'ERR_REPOSITORY_PAYLOAD_MISSING', stepId: 'repo' });
            controller.close();
            return;
          }
          const repoName = extractRepoName(source.repo);
          const repoOwner = extractRepoOwner(source.repo, source.ownerLogin);
          projectSlug = normalizeSlug(repoName);
          if (!projectSlug || !repoOwner) {
            sendError({ message: 'Invalid repository source data', code: 'ERR_REPOSITORY_SOURCE_INVALID', stepId: 'repo' });
            controller.close();
            return;
          }

          state.githubRepoId = source.repo.id != null ? Number(source.repo.id) : undefined;
          state.githubFullName = source.repo.full_name || `${repoOwner}/${repoName}`;
          state.githubRepoOwner = repoOwner;
          state.githubRepoName = repoName;
          const repoPrivateFlag = typeof source.repo.private === 'boolean' ? source.repo.private : null;
          if (repoPrivateFlag === false) {
            formsGitStorageEnabled = false;
            formsStoragePolicy = 'db_only_public_repo';
          }
          send('log', { stepId: 'repo', message: 'Repository esistente collegato' });
        }

        send('step', { id: 'repo', status: 'done' });
        send('step', { id: 'vercel', status: 'running', label: 'Progetto Vercel' });
        send('log', { stepId: 'vercel', message: 'Verifica nome disponibile su Vercel...' });

        let vercelSlug: string;
        let namingAttempts = 1;
        try {
          const naming = await findFreeVercelName(teamId, token, projectSlug, (msg) => send('log', { stepId: 'vercel', message: msg }));
          vercelSlug = naming.projectName;
          namingAttempts = naming.attemptCount;
          send('log', {
            stepId: 'vercel',
            message: `Naming resolution: requested="${projectSlug}", candidate="${vercelSlug}", attempts=${namingAttempts}.`,
          });
        } catch (e: unknown) {
          sendError({
            message: e instanceof Error ? e.message : 'Nome Vercel non disponibile',
            code: ERR.VERCEL_FAILED,
            stepId: 'vercel',
            provider: 'vercel',
          });
          controller.close();
          return;
        }
        send('log', { stepId: 'vercel', message: 'Creazione progetto su Vercel...' });

        try {
          const res = await fetch(`https://api.vercel.com/v9/projects?teamId=${encodeURIComponent(teamId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: vercelSlug,
              framework: 'vite',
              gitRepository: { type: 'github', repo: state.githubFullName! },
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            const msg = data?.error?.message || `Vercel ${res.status}`;
            sendError({
              message: msg,
              code: res.status === 403 || data?.error?.code === 'LIMIT_REACHED' ? ERR.VERCEL_LIMIT_REACHED : ERR.VERCEL_FAILED,
              stepId: 'vercel',
              provider: 'vercel',
              providerStatus: res.status,
            });
            controller.close();
            return;
          }
          state.vercelProjectId = data.id;
          if (data.link?.repoId != null) state.vercelRepoId = Number(data.link.repoId);
          if (typeof data.name === "string" && data.name.trim()) {
            const assignedName = data.name.trim();
            if (assignedName !== vercelSlug) {
              send('log', { stepId: 'vercel', message: `Vercel ha assegnato il nome "${assignedName}" (richiesto: "${vercelSlug}").` });
            }
            vercelSlug = assignedName;
          }
          send('log', { stepId: 'vercel', message: 'Progetto creato, repo collegato' });
        } catch (e: unknown) {
          sendError({
            message: (e instanceof Error ? e.message : String(e)) || 'Vercel failed',
            code: ERR.VERCEL_FAILED,
            stepId: 'vercel',
            provider: 'vercel',
          });
          controller.close();
          return;
        }

        // Admin keypair bootstrap: generate EC P-256, stash on state for later
        // tenant INSERT (admin_private_key, encrypted at-rest via pgsodium) and
        // for the ADMIN_PUBLIC_KEY env var pushed to Vercel below.
        try {
          const { privateKey, publicKey } = generateKeyPairSync('ec', {
            namedCurve: 'P-256',
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
          });
          createPublicKey(publicKey);
          state.adminPrivateKeyPem = privateKey;
          state.adminPublicKeyPem = publicKey;
          send('log', { stepId: 'vercel', message: 'Admin keypair generato' });
        } catch (e: unknown) {
          send('log', {
            stepId: 'vercel',
            message: `WARN: admin keypair non generato (${e instanceof Error ? e.message : 'unknown'}) — provision continua, configurabile dal dashboard.`,
          });
        }

        send('step', { id: 'vercel', status: 'done' });
        send('step', { id: 'env', status: 'running', label: 'Variabili ENV' });
        send('log', { stepId: 'env', message: 'Iniezione variabili...' });

        if (isSave2RoutesBetaEnabled()) {
          try {
            state.vercelEdgeConfigId = await ensureEdgeConfigId({
              existingId: null,
              tenantSlug: vercelSlug,
            });
            send('log', { stepId: 'env', message: `Edge config bound: ${state.vercelEdgeConfigId}` });
          } catch (e: unknown) {
            sendError({
              message: (e instanceof Error ? e.message : String(e)) || 'Edge config provisioning failed',
              code: ERR.VERCEL_ENV_FAILED,
              stepId: 'env',
              provider: 'vercel',
            });
            controller.close();
            return;
          }
        }

        const blobPublicBase = process.env.JSONPAGES_BLOB_PUBLIC_BASE?.trim();
        const envs = [
          { key: 'VITE_JSONPAGES_CLOUD_URL', value: JSONPAGES_CLOUD_URL, type: 'encrypted' as const, target: ['production', 'preview'] as const },
          { key: 'VITE_JSONPAGES_API_KEY', value: apiKey, type: 'encrypted' as const, target: ['production', 'preview'] as const },
          ...(blobPublicBase
            ? [{ key: 'BLOB_TENANT_DISCOVERY_BASE', value: `${blobPublicBase}/tenants/${vercelSlug}`, type: 'plain' as const, target: ['production', 'preview'] as const }]
            : []),
          ...(state.adminPublicKeyPem
            ? [{ key: 'ADMIN_PUBLIC_KEY', value: state.adminPublicKeyPem, type: 'encrypted' as const, target: ['production', 'preview'] as const }]
            : []),
        ];
        for (const env of envs) {
          const envRes = await fetch(
            `https://api.vercel.com/v10/projects/${state.vercelProjectId}/env?teamId=${encodeURIComponent(teamId)}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: env.key, value: env.value, type: env.type, target: env.target }),
            }
          );
          if (!envRes.ok) {
            const err = await envRes.json().catch(() => ({}));
            sendError({
              message: (err?.error?.message || 'Env failed') + ` (${env.key})`,
              code: ERR.VERCEL_ENV_FAILED,
              stepId: 'env',
              provider: 'vercel',
              providerStatus: envRes.status,
            });
            controller.close();
            return;
          }
        }

        send('log', { stepId: 'env', message: 'Variabili impostate' });

        if (source.type === 'template' && blobPublicBase && state.githubRepoOwner && state.githubRepoName) {
          try {
            const appBlob = new App({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n') });
            const octokitBlob = await appBlob.getInstallationOctokit(Number(installationId));
            const fileRes = await octokitBlob.rest.repos.getContent({
              owner: state.githubRepoOwner,
              repo: state.githubRepoName,
              path: 'vercel.json',
            });
            const fileData = fileRes.data;
            if (!Array.isArray(fileData) && 'content' in fileData && 'sha' in fileData) {
              const raw = Buffer.from(fileData.content, 'base64').toString('utf-8');
              const resolved = raw
                .replace(/\{BLOB_BASE\}/g, blobPublicBase)
                .replace(/\{slug\}/g, vercelSlug);
              await octokitBlob.rest.repos.createOrUpdateFileContents({
                owner: state.githubRepoOwner,
                repo: state.githubRepoName,
                path: 'vercel.json',
                message: 'chore: resolve Blob discovery rewrites',
                content: Buffer.from(resolved).toString('base64'),
                sha: fileData.sha,
              });
              send('log', { stepId: 'env', message: 'vercel.json: Blob rewrites risolti.' });
            }
          } catch (blobJsonErr) {
            const msg = blobJsonErr instanceof Error ? blobJsonErr.message : 'Unknown error';
            send('log', { stepId: 'env', message: `WARN: vercel.json Blob resolve fallito (${msg}) — provision non bloccato.` });
          }
        }

        send('step', { id: 'env', status: 'done' });

        if (blobPublicBase && state.githubRepoOwner && state.githubRepoName) {
          try {
            const vercelJsonContent = JSON.stringify({
              rewrites: [
                { source: '/robots.txt',                        destination: `${blobPublicBase}/tenants/${vercelSlug}/robots.txt` },
                { source: '/sitemap.xml',                       destination: `${blobPublicBase}/tenants/${vercelSlug}/sitemap.xml` },
                { source: '/llms.txt',                          destination: `${blobPublicBase}/tenants/${vercelSlug}/llms.txt` },
                { source: '/.well-known/agent-card.json',       destination: `${blobPublicBase}/tenants/${vercelSlug}/.well-known/agent-card.json` },
                { source: '/mcp-manifest.json',                 destination: `${blobPublicBase}/tenants/${vercelSlug}/mcp-manifest.json` },
                { source: '/mcp-manifests/:path*.json',         destination: `${blobPublicBase}/tenants/${vercelSlug}/mcp-manifests/:path*.json` },
                { source: '/schemas/:path*.json',               destination: `${blobPublicBase}/tenants/${vercelSlug}/schemas/:path*.json` },
                { source: '/:path*.json',                       destination: `${blobPublicBase}/tenants/${vercelSlug}/pages/:path*.json` },
                { source: '/(.*)',                              destination: '/index.html' },
              ],
              headers: [
                { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
              ],
            }, null, 2);
            const appVj = new App({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n') });
            const octokitVj = await appVj.getInstallationOctokit(Number(installationId));
            let existingSha: string | undefined;
            try {
              const existing = await octokitVj.rest.repos.getContent({ owner: state.githubRepoOwner, repo: state.githubRepoName, path: 'vercel.json' });
              const d = existing.data;
              if (!Array.isArray(d) && 'sha' in d) existingSha = d.sha;
            } catch { /* file non esiste */ }
            await octokitVj.rest.repos.createOrUpdateFileContents({
              owner: state.githubRepoOwner,
              repo: state.githubRepoName,
              path: 'vercel.json',
              message: 'chore: configure Blob discovery rewrites',
              content: Buffer.from(vercelJsonContent).toString('base64'),
              ...(existingSha ? { sha: existingSha } : {}),
            });
            send('log', { stepId: 'env', message: 'vercel.json: Blob rewrites configurati.' });
          } catch (vjErr) {
            const msg = vjErr instanceof Error ? vjErr.message : 'Unknown error';
            send('log', { stepId: 'env', message: `WARN: vercel.json commit fallito (${msg}) — provision non bloccato.` });
          }
        }

        let cachedContentPayload: TenantContentPayload | null = null;

        if (state.githubRepoOwner && state.githubRepoName) {
          try {
            const appSf = new App({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n') });
            const octokitSf = await appSf.getInstallationOctokit(Number(installationId));
            const sfSiteContent = await getRepoJsonFile(octokitSf, state.githubRepoOwner, state.githubRepoName, 'src/data/config/site.json');
            const sfPagePaths = await listRepoPagePaths(octokitSf, state.githubRepoOwner, state.githubRepoName);
            const sfPageFiles = await Promise.all(
              sfPagePaths.map(async (path) => ({
                path,
                content: await getRepoJsonFile(octokitSf, state.githubRepoOwner!, state.githubRepoName!, path),
              }))
            );
            const sfMapping = mapRepoJsonFilesToEdgeEntries([
              { path: 'src/data/config/site.json', content: sfSiteContent },
              ...sfPageFiles,
            ]);
            if (sfMapping.entries.length > 0) {
              const sfPayload: TenantContentPayload = { siteConfig: null, pages: {} };
              for (const entry of sfMapping.entries) {
                if (entry.type === 'config') sfPayload.siteConfig = entry.data;
                if (entry.type === 'page') sfPayload.pages[entry.slug] = entry.data;
              }
              cachedContentPayload = sfPayload;
            }
          } catch (sfErr) {
            const msg = sfErr instanceof Error ? sfErr.message : 'Unknown error';
            send('log', { stepId: 'env', message: `WARN: lettura contenuti GitHub fallita (${msg}).` });
          }
        }

        send('step', { id: 'deploy', status: 'running', label: 'Attesa deploy' });

        if (state.vercelRepoId == null) {
          sendError({
            message: 'Vercel non ha restituito il link al repository. Riprova o crea il deploy da dashboard Vercel.',
            code: ERR.VERCEL_FAILED,
            stepId: 'deploy',
            provider: 'vercel',
          });
          controller.close();
          return;
        }

        send('log', { stepId: 'deploy', message: 'Avvio primo deploy da branch main...' });
        let vercelDeploymentId: string | null = null;
        try {
          const deployRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(teamId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: vercelSlug,
              project: state.vercelProjectId,
              gitSource: { type: 'github', ref: 'main', repoId: state.vercelRepoId },
              projectSettings: { framework: 'vite' },
              target: 'production',
            }),
          });
          const deployData = await deployRes.json();
          if (!deployRes.ok) {
            const msg = deployData?.error?.message || `Vercel deploy ${deployRes.status}`;
            await deleteVercelProjectBestEffort({
              teamId,
              token,
              projectId: state.vercelProjectId,
              requestId,
              sendLog: (message) => send('log', { stepId: 'deploy', message }),
            });
            sendError({
              message: msg,
              code: ERR.VERCEL_FAILED,
              stepId: 'deploy',
              provider: 'vercel',
              providerStatus: deployRes.status,
            });
            controller.close();
            return;
          }
          vercelDeploymentId = typeof deployData.id === 'string' && deployData.id.trim() ? deployData.id.trim() : null;
          send('log', { stepId: 'deploy', message: 'Deploy avviato, in attesa build...' });
        } catch (e: unknown) {
          await deleteVercelProjectBestEffort({
            teamId,
            token,
            projectId: state.vercelProjectId,
            requestId,
            sendLog: (message) => send('log', { stepId: 'deploy', message }),
          });
          sendError({
            message: (e instanceof Error ? e.message : String(e)) || 'Avvio deploy fallito',
            code: ERR.VERCEL_FAILED,
            stepId: 'deploy',
            provider: 'vercel',
          });
          controller.close();
          return;
        }

        if (!vercelDeploymentId) {
          await deleteVercelProjectBestEffort({
            teamId, token, projectId: state.vercelProjectId, requestId,
            sendLog: (message) => send('log', { stepId: 'deploy', message }),
          });
          sendError({ message: 'Vercel deploy response missing deployment id', code: ERR.VERCEL_FAILED, stepId: 'deploy', provider: 'vercel' });
          controller.close();
          return;
        }

        const deployResult = await waitForDeployReady(vercelDeploymentId, teamId, token, (msg) =>
          send('log', { stepId: 'deploy', message: msg })
        );
        if (!deployResult) {
          await deleteVercelProjectBestEffort({
            teamId,
            token,
            projectId: state.vercelProjectId,
            requestId,
            sendLog: (message) => send('log', { stepId: 'deploy', message }),
          });
          sendError({
            message:
              'Build failed. Review your code and retry provisioning. Il progetto Vercel temporaneo e stato rimosso (best effort).',
            code: ERR.VERCEL_FAILED,
            stepId: 'deploy',
            provider: 'vercel',
          });
          controller.close();
          return;
        }

        send('step', { id: 'deploy', status: 'done' });
        send('log', { stepId: 'deploy', message: `Deployment URL: ${deployResult.deploymentUrl} | Public URL: ${deployResult.publicUrl ?? 'n/a'}` });
        console.info('[tenants/provision-stream] naming-resolution', {
          requestedName: projectSlug,
          finalProjectName: vercelSlug,
          attemptCount: namingAttempts,
          vercelProjectId: state.vercelProjectId,
          deploymentUrl: deployResult.deploymentUrl,
          publicUrl: deployResult.publicUrl,
        });

        send('step', { id: 'static-files', status: 'running', label: 'File statici' });
        if (blobPublicBase && deployResult.publicUrl && cachedContentPayload) {
          try {
            const staticFiles = generateTenantStaticFiles({
              tenantSlug: vercelSlug,
              pages: cachedContentPayload.pages as Record<string, unknown>,
              siteConfig: cachedContentPayload.siteConfig,
              baseUrl: deployResult.publicUrl,
            });
            await uploadTenantStaticFiles(staticFiles);
            send('log', { stepId: 'static-files', message: `File statici caricati su blob (${staticFiles.length} files).` });
          } catch (sfErr) {
            const msg = sfErr instanceof Error ? sfErr.message : 'Unknown error';
            send('log', { stepId: 'static-files', message: `WARN: file statici non generati (${msg}) — provision non bloccato.` });
          }
        } else {
          const reason = !blobPublicBase ? 'Blob non configurato' : !deployResult.publicUrl ? 'public URL non disponibile' : 'contenuti non letti';
          send('log', { stepId: 'static-files', message: `WARN: file statici saltati (${reason}).` });
        }
        send('step', { id: 'static-files', status: 'done' });

        send('step', { id: 'db', status: 'running', label: 'Salvataggio tenant' });
        let tenantId: string;
        try {
          const { data: tenant, error } = await supabase
            .from('tenants')
            .insert({
              owner_id: userId,
              name: state.githubRepoName,
              slug: vercelSlug,
              github_repo_owner: state.githubRepoOwner,
              github_repo_name: state.githubRepoName,
              github_repo_id: state.githubRepoId,
              github_installation_id: String(installationId),
              vercel_project_id: state.vercelProjectId,
              vercel_edge_config_id: state.vercelEdgeConfigId ?? null,
              vercel_url: deployResult.deploymentUrl,
              vercel_public_url: deployResult.publicUrl,
              requested_name: projectSlug,
              final_project_name: vercelSlug,
              naming_attempts: namingAttempts,
              forms_git_storage_enabled: formsGitStorageEnabled,
              forms_storage_policy: formsStoragePolicy,
              api_key: apiKey,
              admin_private_key: state.adminPrivateKeyPem ?? null,
              status: 'provisioned',
            })
            .select('id')
            .single();
          if (error) throw error;
          if (!tenant?.id) throw new Error('Insert did not return id');
          tenantId = tenant.id;
        } catch (e: unknown) {
          sendError({
            message: (e instanceof Error ? e.message : String(e)) || 'Database failed',
            code: ERR.SUPABASE_FAILED,
            stepId: 'db',
            provider: 'supabase',
          });
          controller.close();
          return;
        }

        if (entitlementCorrelationId && entitlementPlanCode) {
          const claimTimestamp = new Date().toISOString();
          const claimResult = await supabase
            .from('billing_intents')
            .update({
              tenant_id: tenantId,
              state: 'licensed_ready_assigned',
              updated_at: claimTimestamp,
            })
            .eq('user_id', userId)
            .eq('plan_code', entitlementPlanCode)
            .eq('correlation_id', entitlementCorrelationId)
            .eq('state', 'licensed_ready_unassigned')
            .is('tenant_id', null)
            .select('id')
            .limit(1);

          if (claimResult.error) {
            console.error('[tenants/provision-stream] entitlement-claim-error', {
              userId,
              tenantId,
              entitlementCorrelationId,
              entitlementPlanCode,
              error: claimResult.error.message,
            });
            sendError({
              message: 'Entitlement claim failed while binding tenant',
              code: ERR.SUPABASE_FAILED,
              stepId: 'db',
              provider: 'supabase',
            });
            controller.close();
            return;
          }

          if (!claimResult.data || claimResult.data.length === 0) {
            console.warn('[tenants/provision-stream] entitlement-claim-conflict', {
              userId,
              tenantId,
              entitlementCorrelationId,
              entitlementPlanCode,
            });
            sendError({
              message: 'Entitlement unavailable or already consumed for this correlation',
              code: 'ERR_ENTITLEMENT_CONSUME_CONFLICT',
              stepId: 'db',
              provider: 'supabase',
            });
            controller.close();
            return;
          }

          console.info('[tenants/provision-stream] entitlement-claimed', {
            userId,
            tenantId,
            entitlementCorrelationId,
            entitlementPlanCode,
          });
        } else if (entitlementCorrelationId || entitlementPlanCode) {
          console.warn('[tenants/provision-stream] entitlement-claim-skipped-missing-fields', {
            userId,
            tenantId,
            entitlementCorrelationId: entitlementCorrelationId ?? null,
            entitlementPlanCode: entitlementPlanCode ?? null,
          });
        }

        send('log', { stepId: 'db', message: 'Bootstrap contenuti iniziali dal repository...' });
        try {
          if (!state.githubRepoOwner || !state.githubRepoName) {
            throw new Error('Missing repository coordinates for content bootstrap');
          }
          let contentPayload: TenantContentPayload;
          if (cachedContentPayload) {
            contentPayload = cachedContentPayload;
          } else {
            const repoOwner = state.githubRepoOwner;
            const repoName = state.githubRepoName;
            const app = new App({
              appId: process.env.GITHUB_APP_ID!,
              privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
            });
            const octokit = await app.getInstallationOctokit(Number(installationId));
            const siteContent = await getRepoJsonFile(octokit, repoOwner, repoName, 'src/data/config/site.json');
            const pagePaths = await listRepoPagePaths(octokit, repoOwner, repoName);
            const pageFiles = await Promise.all(
              pagePaths.map(async (path) => ({
                path,
                content: await getRepoJsonFile(octokit, repoOwner, repoName, path),
              }))
            );
            const mapping = mapRepoJsonFilesToEdgeEntries([
              { path: 'src/data/config/site.json', content: siteContent },
              ...pageFiles,
            ]);
            if (mapping.entries.length === 0) {
              throw new Error('No valid page/config files found for bootstrap');
            }
            contentPayload = { siteConfig: null, pages: {} };
            for (const entry of mapping.entries) {
              if (entry.type === 'config') contentPayload.siteConfig = entry.data;
              if (entry.type === 'page') contentPayload.pages[entry.slug] = entry.data;
            }
          }
          await replaceTenantContent(tenantId, contentPayload, { updatedBy: `provision:${userId}` });
          send('log', {
            stepId: 'db',
            message: `Bootstrap completato (pages=${Object.keys(contentPayload.pages).length}, config=${contentPayload.siteConfig ? 1 : 0}).`,
          });
        } catch (e: unknown) {
          sendError({
            message: (e instanceof Error ? e.message : String(e)) || 'Tenant content bootstrap failed',
            code: 'ERR_TENANT_BOOTSTRAP_FAILED',
            stepId: 'db',
            provider: 'system',
          });
          controller.close();
          return;
        }

        void refreshTenantPreview({
          tenantId,
          tenantUrl: deployResult.publicUrl ?? deployResult.deploymentUrl,
          reason: 'provision',
          correlationId: requestId,
        }).catch((error) => {
          console.error('[tenants/provision-stream] preview-refresh-failed', {
            tenantId,
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
          void reconcileTenantPreviews({
            tenantIds: [tenantId],
            reason: 'provision',
            correlationId: requestId,
            pendingGraceMs: 0,
            limit: 1,
          }).catch((reconcileError) => {
            console.error('[tenants/provision-stream] preview-reconcile-failed', {
              tenantId,
              requestId,
              message: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
            });
          });
        });

        send('step', { id: 'db', status: 'done' });
        send('done', {
          tenant: {
            id: tenantId,
            slug: vercelSlug,
            name: state.githubRepoName,
            github_repo_id: state.githubRepoId,
            github_repo_name: state.githubFullName,
            vercel_project_id: state.vercelProjectId,
            vercel_edge_config_id: state.vercelEdgeConfigId ?? null,
            vercel_url: deployResult.deploymentUrl,
            requested_name: projectSlug,
            final_project_name: vercelSlug,
            naming_attempts: namingAttempts,
            status: 'provisioned',
          },
          api_key: apiKey,
          deployUrl: deployResult.publicUrl ?? deployResult.deploymentUrl,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        console.error('[tenants/provision-stream]', err);
        sendError({ message, code: 'ERR_PROVISION_STREAM_INTERNAL', stepId: 'repo' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'keep-alive',
    },
  });
}
