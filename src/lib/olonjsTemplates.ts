import { App } from 'octokit';
import { unstable_cache } from 'next/cache';

const TEMPLATE_ORG = 'olonjs' as const;
const CACHE_TTL_SECONDS = 300;

export interface OlonjsTemplate {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  homepage: string;
  previewUrl: string;
}

function buildPreviewUrl(owner: string, repo: string, cacheBuster: string): string {
  const safe = cacheBuster.replace(/[^0-9]/g, '') || '1';
  return `https://opengraph.githubassets.com/${safe}/${owner}/${repo}`;
}

async function fetchOlonjsTemplatesUncached(): Promise<OlonjsTemplate[]> {
  const app = new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  });

  const { data: installation } = await app.octokit.rest.apps.getOrgInstallation({
    org: TEMPLATE_ORG,
  });

  const octokit = await app.getInstallationOctokit(installation.id);

  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org: TEMPLATE_ORG,
    type: 'public',
    per_page: 100,
  });

  return repos
    .filter((r) => r.is_template === true && r.archived === false && r.private === false)
    .map((r) => ({
      owner: r.owner.login,
      repo: r.name,
      description: r.description ?? '',
      defaultBranch: r.default_branch ?? 'main',
      homepage: r.homepage ?? '',
      previewUrl: buildPreviewUrl(r.owner.login, r.name, r.updated_at ?? '1'),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

export const fetchOlonjsTemplates = unstable_cache(
  fetchOlonjsTemplatesUncached,
  ['olonjs-templates'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['templates'] },
);
