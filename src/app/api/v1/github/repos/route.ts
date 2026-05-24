import { NextRequest, NextResponse } from 'next/server';
import { App } from 'octokit';

// Forza il rendering dinamico (Niente Static Generation per questa rotta)
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const installationId = searchParams.get('installation_id');

  if (!installationId) {
    return NextResponse.json({ error: 'Missing installation_id' }, { status: 400 });
  }

  try {
    // 🛠️ FIX: Inizializziamo QUI, non fuori.
    // Così se le env vars mancano in build, non crasha. Crasha solo a runtime (che è gestito).
    const app = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    });

    const octokit = await app.getInstallationOctokit(Number(installationId));
    
    // Chiediamo la lista dei repo accessibili a questa installazione
    // GitHub di default restituisce solo 30 risultati, aumentiamo a 100 (max)
    // Se ci sono più di 100 repo, dobbiamo paginare
    let allRepos: any[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page: page,
      });

      if (data.repositories && data.repositories.length > 0) {
        allRepos = [...allRepos, ...data.repositories];
        // Se abbiamo ricevuto meno di perPage risultati, siamo all'ultima pagina
        hasMore = data.repositories.length === perPage;
        page++;
      } else {
        hasMore = false;
      }
    }

    return NextResponse.json({ repos: allRepos });
  } catch (error: any) {
    console.error("GitHub API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}