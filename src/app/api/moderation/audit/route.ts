import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await getModerator(request)) return NextResponse.json({ error: '审计记录仅限审核人员访问。' }, { status: 403 });
  try {
    const rows = await db.moderationAction.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, targetType: true, targetId: true, action: true, reason: true, createdAt: true, actor: { select: { id: true, username: true } } } });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/moderation/audit', error); return NextResponse.json({ error: '审计记录加载失败。' }, { status: 500 }); }
}
