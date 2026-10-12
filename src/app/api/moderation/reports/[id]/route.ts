import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';

const actions = ['REVIEWING', 'DISMISS', 'HIDE', 'RESTORE', 'BAN', 'UNBAN'] as const;
export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  const moderator = await getModerator(request);
  if (!moderator) return NextResponse.json({ error: '此操作仅限审核人员。' }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: '处置数据格式不正确。' }, { status: 400 }); }
  const action = body?.action, reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!actions.includes(action) || !reason || reason.length > 1000) return NextResponse.json({ error: '请选择处置动作并填写原因，最多 1000 字。' }, { status: 400 });
  try {
    const report = await db.report.findUnique({ where: { id: params.id }, select: { id: true, targetType: true, targetId: true, status: true } });
    if (!report) return NextResponse.json({ error: '举报记录不存在。' }, { status: 404 });
    if (['ACTIONED', 'DISMISSED'].includes(report.status) && !['REVIEWING', 'UNBAN'].includes(action)) return NextResponse.json({ error: '该举报已结案，请查看审计记录。' }, { status: 409 });
    if (['HIDE', 'RESTORE'].includes(action) && !['POST', 'POST_COMMENT'].includes(report.targetType)) return NextResponse.json({ error: '当前举报目标不支持此内容处置。' }, { status: 400 });
    if (['BAN', 'UNBAN'].includes(action) && report.targetType !== 'USER') return NextResponse.json({ error: '封禁操作仅适用于用户举报。' }, { status: 400 });
    const reportStatus = action === 'REVIEWING' ? 'REVIEWING' : action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED';
    await db.$transaction(async tx => {
      if (['OPEN', 'REVIEWING'].includes(report.status)) {
        const claimed = await tx.report.updateMany({ where: { id: report.id, status: { in: ['OPEN', 'REVIEWING'] } }, data: { status: reportStatus } });
        if (!claimed.count) throw new Error('REPORT_ALREADY_CLOSED');
      }
      if (action === 'HIDE' || action === 'RESTORE') {
        const status = action === 'HIDE' ? 'HIDDEN' : 'VISIBLE';
        const result = report.targetType === 'POST'
          ? await tx.post.updateMany({ where: { id: report.targetId }, data: { status } })
          : await tx.postComment.updateMany({ where: { id: report.targetId }, data: { status } });
        if (!result.count) throw new Error('CONTENT_TARGET_MISSING');
      } else if (action === 'BAN' || action === 'UNBAN') {
        const result = await tx.user.updateMany({ where: { id: report.targetId, ...(action === 'UNBAN' ? { communityBannedAt: { not: null } } : {}) }, data: action === 'BAN' ? { communityBannedAt: new Date(), communityBanReason: reason } : { communityBannedAt: null, communityBanReason: null } });
        if (!result.count) throw new Error(action === 'UNBAN' ? 'USER_NOT_BANNED' : 'USER_TARGET_MISSING');
      }
      await tx.moderationAction.create({ data: { actorId: moderator.userId, targetType: report.targetType, targetId: report.targetId, action, reason } });
    });
    return NextResponse.json({ success: true, status: reportStatus });
  } catch (error) {
    if (error instanceof Error && ['CONTENT_TARGET_MISSING', 'USER_TARGET_MISSING'].includes(error.message)) return NextResponse.json({ error: '举报目标已不存在，未执行处置。' }, { status: 404 });
    if (error instanceof Error && error.message === 'REPORT_ALREADY_CLOSED') return NextResponse.json({ error: '该举报已被其他审核员处理。' }, { status: 409 });
    if (error instanceof Error && error.message === 'USER_NOT_BANNED') return NextResponse.json({ error: '该账号当前未被封禁。' }, { status: 409 });
    logRouteError('PATCH /api/moderation/reports/[id]', error);
    return NextResponse.json({ error: '举报处置失败。' }, { status: 500 });
  }
}
