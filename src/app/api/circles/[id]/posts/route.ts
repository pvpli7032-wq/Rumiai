import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { hasCircleMembership, parseCommunityBody, postRateLimit, validatePostContent, validatePostImages } from '@/lib/community-posts';
import { formatUser } from '@/lib/user-identity';
import { communityWriteBlock } from '@/lib/community-moderation';

export const dynamic = 'force-dynamic';
const authorSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    const circle = await db.circle.findFirst({ where: { id: params.id, status: 'ACTIVE' }, select: { id: true } });
    if (!circle) return NextResponse.json({ error: '圈子不存在或已隐藏。' }, { status: 404 });
    const url = new URL(request.url);
    const take = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const cursor = url.searchParams.get('cursor');
    const rows = await db.post.findMany({ where: { circleId: circle.id, status: 'VISIBLE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, content: true, createdAt: true, updatedAt: true, authorId: true, author: { select: authorSelect }, media: { orderBy: { position: 'asc' }, select: { id: true, url: true, position: true } }, character: { select: { id: true, name: true, isPublic: true, reviewStatus: true } }, _count: { select: { comments: { where: { status: 'VISIBLE' } } } } } });
    const hasMore = rows.length > take, page = hasMore ? rows.slice(0, take) : rows;
    return NextResponse.json({ posts: page.map(p => ({ id: p.id, content: p.content, createdAt: p.createdAt, updatedAt: p.updatedAt, author: formatUser(p.author), isMine: p.authorId === auth?.userId, images: p.media.map(m => m.url), character: p.character?.isPublic && p.character.reviewStatus === 'APPROVED' ? { id: p.character.id, name: p.character.name } : null, commentCount: p._count.comments })), nextCursor: hasMore ? page[page.length - 1].id : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/circles/[id]/posts', error); return NextResponse.json({ error: '帖子加载失败，请稍后重试。' }, { status: 500 }); }
}

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const blocked = await communityWriteBlock(auth.userId); if (blocked) return blocked;
    const sizeError = parseCommunityBody(request); if (sizeError) return sizeError.response;
    let input; try { input = await request.json(); } catch { return NextResponse.json({ error: '帖子数据格式不正确。' }, { status: 400 }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '帖子数据格式不正确。' }, { status: 400 });
    const content = validatePostContent(input.content), images = await validatePostImages(input.images, auth.userId);
    if ('error' in content) return NextResponse.json({ error: content.error }, { status: 400 });
    if ('error' in images) return NextResponse.json({ error: images.error }, { status: 400 });
    const characterId = input.characterId == null || input.characterId === '' ? null : typeof input.characterId === 'string' ? input.characterId : undefined;
    if (characterId === undefined) return NextResponse.json({ error: '关联角色无效。' }, { status: 400 });
    if (characterId && !await db.character.findFirst({ where: { id: characterId, isPublic: true, reviewStatus: 'APPROVED' }, select: { id: true } })) return NextResponse.json({ error: '只能关联已审核通过的公开角色。' }, { status: 400 });
    if (!await hasCircleMembership(params.id, auth.userId)) return NextResponse.json({ error: '请先订阅该圈子，再发布帖子。' }, { status: 403 });
    const limited = postRateLimit(auth.userId, 'post'); if (limited) return limited;
    const post = await db.post.create({ data: { circleId: params.id, authorId: auth.userId, content: content.content!, characterId, media: { create: images.urls.map((url, position) => ({ url, position })) } }, select: { id: true, content: true, createdAt: true, updatedAt: true, media: { orderBy: { position: 'asc' }, select: { url: true } }, character: { select: { id: true, name: true } }, author: { select: authorSelect } } });
    return NextResponse.json({ post: { ...post, author: formatUser(post.author), isMine: true, images: post.media.map(m => m.url), commentCount: 0 } }, { status: 201 });
  } catch (error) { logRouteError('POST /api/circles/[id]/posts', error); return NextResponse.json({ error: '帖子发布失败，请稍后重试。' }, { status: 500 }); }
}

