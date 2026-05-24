import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parsePlanCode, resolveCorrelationId } from '@/lib/licensing';
import { requireRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get('x-correlation-id'));
  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.data.error, correlationId }, { status: auth.data.status });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('billing_intents')
    .select('id, plan_code, correlation_id, installation_id, updated_at')
    .eq('user_id', auth.data.user.id)
    .eq('state', 'licensed_ready_unassigned')
    .is('tenant_id', null)
    .order('updated_at', { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to read pending entitlements', code: 'ERR_PENDING_ENTITLEMENTS_READ_FAILED', correlationId },
      { status: 500 }
    );
  }

  const entitlements = (data ?? [])
    .map((row: any) => ({
      id: row.id as string,
      planCode: parsePlanCode(row.plan_code) ?? 'starter',
      correlationId: typeof row.correlation_id === 'string' ? row.correlation_id : '',
      installationId: Number.isInteger(row.installation_id) ? row.installation_id : null,
      updatedAt: row.updated_at as string,
    }))
    .filter((row) => row.correlationId);

  return NextResponse.json({ correlationId, entitlements });
}
