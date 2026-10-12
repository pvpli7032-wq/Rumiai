import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await getModerator(request)) return NextResponse.json({ error: '此队列仅限审核人员访问。' }, { status: 403 });
  try {
    const status = new URL(request.url).searchParams.get('status') || 'OPEN';
    if (!['OPEN', 'ACCEPTED', 'REJECTED', 'ALL'].includes(status)) return NextResponse.json({ error: '申诉状态不正确。' }, { status: 400 });
    const rows = await db.communityAppeal.findMany({ where: status === 'ALL' ? {} : { status }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50, select: { id: true, userId: true, reason: true, status: true, resolution: true, createdAt: true, user: { select: { username: true, communityBannedAt: true, communityBanReason: true } } } });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/moderation/appeals', error); return NextResponse.json({ error: '申诉队列加载失败。' }, { status: 500 }); }
}
