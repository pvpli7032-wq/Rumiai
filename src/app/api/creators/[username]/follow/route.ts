import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { logRouteError } from '@/lib/logger';
import { communityWriteBlock } from '@/lib/community-moderation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录后关注创作者。' }, { status: 401 });
    const blocked = await communityWriteBlock(auth.userId); if (blocked) return blocked;
    const target = await db.user.findUnique({ where: { username: params.username }, select: { id: true, username: true } });
    if (!target) return NextResponse.json({ error: '创作者不存在。' }, { status: 404 });
    if (target.id === auth.userId) return NextResponse.json({ error: '不能关注自己。' }, { status: 400 });
    const limit = checkRateLimit(`creator-follow:${auth.userId}`, 60, 60_000);
    if (!limit.allowed) return NextResponse.json({ error: '关注操作太频繁，请稍后重试。' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });

    let followed = false;
    await db.$transaction(async tx => {
      const existing = await tx.follow.findUnique({ where: { followerId_followingId: { followerId: auth.userId, followingId: target.id } }, select: { followerId: true } });
      if (!existing) {
        await tx.follow.create({ data: { followerId: auth.userId, followingId: target.id } });
        followed = true;
      }
      const count = await tx.follow.count({ where: { followingId: target.id } });
      await tx.user.update({ where: { id: target.id }, data: { followerCount: count } });
    }).catch(async error => {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      // A concurrent repeat hit the composite unique key; the first request won.
    });
    return NextResponse.json({ following: true, changed: followed, followerCount: await db.follow.count({ where: { followingId: target.id } }) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('POST /api/creators/[username]/follow', error); return NextResponse.json({ error: '关注失败，请稍后重试。' }, { status: 500 }); }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录后操作。' }, { status: 401 });
    const target = await db.user.findUnique({ where: { username: params.username }, select: { id: true } });
    if (!target) return NextResponse.json({ error: '创作者不存在。' }, { status: 404 });
    const limit = checkRateLimit(`creator-follow:${auth.userId}`, 60, 60_000);
    if (!limit.allowed) return NextResponse.json({ error: '关注操作太频繁，请稍后重试。' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    let changed = false;
    const followerCount = await db.$transaction(async tx => {
      const removed = await tx.follow.deleteMany({ where: { followerId: auth.userId, followingId: target.id } });
      changed = removed.count > 0;
      const count = await tx.follow.count({ where: { followingId: target.id } });
      await tx.user.update({ where: { id: target.id }, data: { followerCount: count } });
      return count;
    });
    return NextResponse.json({ following: false, changed, followerCount }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('DELETE /api/creators/[username]/follow', error); return NextResponse.json({ error: '取消关注失败，请稍后重试。' }, { status: 500 }); }
}
