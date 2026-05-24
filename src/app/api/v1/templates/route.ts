import { NextResponse } from 'next/server';
import { fetchOlonjsTemplates } from '@/lib/olonjsTemplates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const templates = await fetchOlonjsTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/v1/templates failed:', message);
    return NextResponse.json(
      { error: 'github_unreachable', message },
      { status: 503 },
    );
  }
}
