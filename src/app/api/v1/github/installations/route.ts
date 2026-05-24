import { NextRequest, NextResponse } from 'next/server';
import { App } from 'octokit';

// Forza il rendering dinamico
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const installUrl = process.env.GITHUB_APP_INSTALL_URL || 'https://github.com/apps/jsonpages-cloud-sync/installations/new';
    const configureUrl = process.env.GITHUB_APP_CONFIGURE_URL || 'https://github.com/settings/installations';
    
    // Ottieni tutte le installazioni dell'app GitHub usando autenticazione JWT
    let installations: any[] = [];
    let installationsError: string | null = null;

    if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY) {
      installationsError = 'GitHub App non configurata (mancano GITHUB_APP_ID o GITHUB_PRIVATE_KEY).';
    } else {
      try {
        const app = new App({
          appId: process.env.GITHUB_APP_ID,
          privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });

        const response = await app.octokit.request('GET /app/installations', {
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        const installationsData = response.data || [];
        installations = installationsData.map((inst: any) => ({
          id: inst.id,
          account: {
            login: inst.account?.login,
            type: inst.account?.type,
            avatar_url: inst.account?.avatar_url,
          },
          repository_selection: inst.repository_selection,
          created_at: inst.created_at,
        }));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const status = (error as { status?: number })?.status;
        console.error('Error fetching installations:', error);
        installationsError = status === 401
          ? 'GitHub App non autorizzata (verifica GITHUB_APP_ID e GITHUB_PRIVATE_KEY).'
          : status === 404
            ? 'GitHub App non trovata.'
            : `Impossibile caricare le installazioni: ${msg}`;
      }
    }

    return NextResponse.json({
      installUrl,
      configureUrl,
      installations,
      ...(installationsError && { installationsError }),
    });
  } catch (error: any) {
    console.error("GitHub Installations API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
