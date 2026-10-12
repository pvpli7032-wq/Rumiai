import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { allowedModels } from '@/lib/ai/ai-models';

export const dynamic = 'force-dynamic';

/**
 * The models a chat may be switched to. The picker on the chat panel needs this list,
 * and it is the same allowlist PATCH /api/conversations/:id validates against — the
 * chain is env-configured, so nothing client-side can hardcode it correctly.
 */
export async function GET() {
  try {
    const models = allowedModels();
    return NextResponse.json({ models, default: models[0] ?? null });
  } catch (error) {
    logRouteError('GET /api/ai/models', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
