import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  const rows = await db.communityAppeal.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, reason: true, status: true, resolution: true, createdAt: true, updatedAt: true } });
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: '申诉数据格式不正确。' }, { status: 400 }); }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 1000) return NextResponse.json({ error: '请填写 10 至 1000 字的申诉说明。' }, { status: 400 });
  try {
    const appeal = await db.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { communityBannedAt: true } });
      if (!user?.communityBannedAt) throw new Error('USER_NOT_BANNED');
      if (await tx.communityAppeal.findFirst({ where: { userId: auth.userId, status: 'OPEN' }, select: { id: true } })) throw new Error('APPEAL_ALREADY_OPEN');
      const created = await tx.communityAppeal.create({ data: { userId: auth.userId, reason }, select: { id: true, reason: true, status: true, createdAt: true } });
      await tx.moderationAction.create({ data: { actorId: auth.userId, targetType: 'USER', targetId: auth.userId, action: 'APPEAL_SUBMITTED', reason } });
      return created;
    });
    return NextResponse.json(appeal, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_BANNED') return NextResponse.json({ error: '当前账号没有社区封禁，无需申诉。' }, { status: 409 });
    if (error instanceof Error && error.message === 'APPEAL_ALREADY_OPEN') return NextResponse.json({ error: '已有一条申诉正在审核。' }, { status: 409 });
    logRouteError('POST /api/community-appeals', error); return NextResponse.json({ error: '申诉提交失败。' }, { status: 500 });
  }
}
