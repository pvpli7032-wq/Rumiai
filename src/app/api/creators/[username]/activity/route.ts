import { NextResponse } from 'next/server';
import { CreatorReadError, listCreatorActivity } from '@/lib/creators/read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const { username } = await paramsPromise;
  const search = new URL(request.url).searchParams;
  const requestedLimit = Number(search.get('limit')) || 20;
  const take = Math.min(30, Math.max(1, requestedLimit));
  try {
    return NextResponse.json(await listCreatorActivity(username, take, search.get('cursor')), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof CreatorReadError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('GET /api/creators/[username]/activity', error);
    return NextResponse.json({ error: '创作者动态加载失败，请稍后重试。' }, { status: 500 });
  }
}
