import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const creator = await db.user.findUnique({ where: { username: params.username }, select: { id: true } });
    if (!creator) return NextResponse.json({ error: '创作者不存在。' }, { status: 404 });
    const url = new URL(request.url), take = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 20)), cursor = url.searchParams.get('cursor');
    const posts = await db.post.findMany({ where: { authorId: creator.id, status: 'VISIBLE', circle: { status: 'ACTIVE' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, content: true, createdAt: true, media: { orderBy: { position: 'asc' }, select: { url: true } }, circle: { select: { id: true, name: true } }, character: { select: { id: true, name: true, isPublic: true, reviewStatus: true } }, _count: { select: { comments: { where: { status: 'VISIBLE' } } } } } });
    const hasMore = posts.length > take, page = hasMore ? posts.slice(0, take) : posts;
    return NextResponse.json({ posts: page.map(post => ({ id: post.id, content: post.content, createdAt: post.createdAt, images: post.media.map(image => image.url), circle: post.circle, character: post.character?.isPublic && post.character.reviewStatus === 'APPROVED' ? { id: post.character.id, name: post.character.name } : null, commentCount: post._count.comments })), nextCursor: hasMore ? page[page.length - 1].id : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/creators/[username]/activity', error); return NextResponse.json({ error: '创作者动态加载失败，请稍后重试。' }, { status: 500 }); }
}
