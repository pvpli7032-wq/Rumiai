import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!await getModerator(request)) return NextResponse.json({ error: '此队列仅限审核人员访问。' }, { status: 403 });
  try {
    const search = new URL(request.url).searchParams;
    const status = search.get('status') || 'OPEN';
    if (!['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'ALL'].includes(status)) return NextResponse.json({ error: '举报状态不正确。' }, { status: 400 });
    const reports = await db.report.findMany({ where: status === 'ALL' ? {} : { status }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.min(50, Math.max(1, Number(search.get('limit')) || 30)), select: { id: true, targetType: true, targetId: true, category: true, details: true, evidenceContent: true, imageReason: true, workTitle: true, relationship: true, sourceLink: true, status: true, createdAt: true, reporter: { select: { id: true, username: true, displayName: true } } } });
    const rows = await Promise.all(reports.map(async report => {
      let target: unknown = null;
      if (report.targetType === 'POST') target = await db.post.findUnique({ where: { id: report.targetId }, select: { id: true, content: true, status: true, author: { select: { id: true, username: true } }, circle: { select: { id: true, name: true, status: true } } } });
      else if (report.targetType === 'POST_COMMENT') target = await db.postComment.findUnique({ where: { id: report.targetId }, select: { id: true, content: true, imageUrl: true, status: true, author: { select: { id: true, username: true } }, post: { select: { id: true, content: true, circle: { select: { id: true, name: true } } } } } });
      else if (report.targetType === 'USER') target = await db.user.findUnique({ where: { id: report.targetId }, select: { id: true, username: true, displayName: true, communityBannedAt: true, communityBanReason: true } });
      else if (report.targetType === 'CHARACTER') target = await db.character.findUnique({ where: { id: report.targetId }, select: { id: true, name: true, isPublic: true, reviewStatus: true, creator: { select: { id: true, username: true } } } });
      return { ...report, target };
    }));
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/moderation/reports', error); return NextResponse.json({ error: '举报队列加载失败。' }, { status: 500 }); }
}
