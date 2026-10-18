import { NextResponse } from 'next/server';
import { CreatorReadError, listCreatorConnections } from '@/lib/creators/read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const { username } = await paramsPromise;
  const search = new URL(request.url).searchParams;
  const rawType = search.get('type') || 'followers';
  if (rawType !== 'followers' && rawType !== 'following') {
    return NextResponse.json({ error: '列表类型不正确。' }, { status: 400 });
  }
  const requestedLimit = Number(search.get('limit')) || 30;
  const take = Math.min(50, Math.max(1, requestedLimit));
  try {
    return NextResponse.json(await listCreatorConnections(username, rawType, take, search.get('cursor')), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof CreatorReadError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('GET /api/creators/[username]/connections', error);
    return NextResponse.json({ error: '关注列表加载失败，请稍后重试。' }, { status: 500 });
  }
}
