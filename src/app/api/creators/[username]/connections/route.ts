import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { formatUser } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';
const userSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const creator = await db.user.findUnique({ where: { username: params.username }, select: { id: true, username: true } });
    if (!creator) return NextResponse.json({ error: '创作者不存在。' }, { status: 404 });
    const search = new URL(request.url).searchParams;
    const type = search.get('type') || 'followers';
    if (!['followers', 'following'].includes(type)) return NextResponse.json({ error: '列表类型不正确。' }, { status: 400 });
    const cursor = search.get('cursor'), take = Math.min(50, Math.max(1, Number(search.get('limit')) || 30));
    const where = type === 'followers' ? { followingId: creator.id } : { followerId: creator.id };
    const rows = await db.follow.findMany({ where, orderBy: [{ createdAt: 'desc' }, { followerId: 'asc' }], take: take + 1, ...(cursor ? { cursor: { followerId_followingId: type === 'followers' ? { followerId: cursor, followingId: creator.id } : { followerId: creator.id, followingId: cursor } }, skip: 1 } : {}), select: { followerId: true, followingId: true, createdAt: true, follower: { select: userSelect }, following: { select: userSelect } } });
    const hasMore = rows.length > take, page = hasMore ? rows.slice(0, take) : rows;
    const users = page.map(row => ({ ...formatUser(type === 'followers' ? row.follower : row.following), followedAt: row.createdAt }));
    const nextCursor = hasMore ? (type === 'followers' ? page[page.length - 1].followerId : page[page.length - 1].followingId) : null;
    const total = await db.follow.count({ where });
    return NextResponse.json({ type, users, total, nextCursor }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/creators/[username]/connections', error); return NextResponse.json({ error: '关注列表加载失败，请稍后重试。' }, { status: 500 }); }
}
