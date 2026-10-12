import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';

export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  const moderator = await getModerator(request);
  if (!moderator) return NextResponse.json({ error: '此操作仅限审核人员。' }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: '复核数据格式不正确。' }, { status: 400 }); }
  const status = body?.status, resolution = typeof body?.resolution === 'string' ? body.resolution.trim() : '';
  if (!['ACCEPTED', 'REJECTED'].includes(status) || !resolution || resolution.length > 1000) return NextResponse.json({ error: '请选择复核结果并填写说明，最多 1000 字。' }, { status: 400 });
  try {
    const appeal = await db.communityAppeal.findUnique({ where: { id: params.id }, select: { id: true, userId: true, status: true } });
    if (!appeal) return NextResponse.json({ error: '申诉记录不存在。' }, { status: 404 });
    if (appeal.status !== 'OPEN') return NextResponse.json({ error: '该申诉已处理。' }, { status: 409 });
    await db.$transaction(async tx => {
      const saved = await tx.communityAppeal.updateMany({ where: { id: appeal.id, status: 'OPEN' }, data: { status, resolution, reviewedBy: moderator.userId, reviewedAt: new Date() } });
      if (!saved.count) throw new Error('APPEAL_ALREADY_REVIEWED');
      if (status === 'ACCEPTED') await tx.user.update({ where: { id: appeal.userId }, data: { communityBannedAt: null, communityBanReason: null } });
      await tx.moderationAction.create({ data: { actorId: moderator.userId, targetType: 'APPEAL', targetId: appeal.id, action: 'APPEAL_REVIEWED_' + status, reason: resolution } });
    });
    return NextResponse.json({ success: true, status });
  } catch (error) {
    if (error instanceof Error && error.message === 'APPEAL_ALREADY_REVIEWED') return NextResponse.json({ error: '申诉已被其他审核员处理。' }, { status: 409 });
    logRouteError('PATCH /api/moderation/appeals/[id]', error); return NextResponse.json({ error: '申诉复核失败。' }, { status: 500 });
  }
}
