import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { formatUser } from '@/lib/user-identity';
import { hasCircleMembership, parseCommunityBody, POST_COMMENT_MAX_CHARS, postRateLimit, validatePostImages } from '@/lib/community-posts';
import { communityWriteBlock } from '@/lib/community-moderation';

export const dynamic = 'force-dynamic';
const authorSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const post = await db.post.findFirst({ where: { id: params.id, status: 'VISIBLE', circle: { status: 'ACTIVE' } }, select: { id: true } });
    if (!post) return NextResponse.json({ error: '帖子不存在或已隐藏。' }, { status: 404 });
    const auth = await getAuthUser(request), url = new URL(request.url), take = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30)), cursor = url.searchParams.get('cursor');
    const rows = await db.postComment.findMany({ where: { postId: post.id, status: 'VISIBLE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, content: true, imageUrl: true, createdAt: true, updatedAt: true, authorId: true, author: { select: authorSelect } } });
    const hasMore = rows.length > take, page = hasMore ? rows.slice(0, take) : rows;
    return NextResponse.json({ comments: page.map(c => ({ id: c.id, content: c.content, imageUrl: c.imageUrl, createdAt: c.createdAt, updatedAt: c.updatedAt, author: formatUser(c.author), isMine: c.authorId === auth?.userId })), nextCursor: hasMore ? page[page.length - 1].id : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/posts/[id]/comments', error); return NextResponse.json({ error: '评论加载失败，请稍后重试。' }, { status: 500 }); }
}

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const blocked = await communityWriteBlock(auth.userId); if (blocked) return blocked;
    const sizeError = parseCommunityBody(request, 20_000); if (sizeError) return sizeError.response;
    let input; try { input = await request.json(); } catch { return NextResponse.json({ error: '评论数据格式不正确。' }, { status: 400 }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '评论数据格式不正确。' }, { status: 400 });
    const content = typeof input.content === 'string' ? input.content.trim() : '', imageUrl = input.imageUrl === undefined || input.imageUrl === null || input.imageUrl === '' ? null : input.imageUrl;
    if (!content && !imageUrl) return NextResponse.json({ error: '请填写评论或添加图片。' }, { status: 400 });
    if (content.length > POST_COMMENT_MAX_CHARS) return NextResponse.json({ error: `评论不能超过 ${POST_COMMENT_MAX_CHARS} 字符。` }, { status: 400 });
    const image = imageUrl === null ? { urls: [] as string[] } : await validatePostImages([imageUrl], auth.userId);
    if ('error' in image) return NextResponse.json({ error: image.error }, { status: 400 });
    const post = await db.post.findFirst({ where: { id: params.id, status: 'VISIBLE', circle: { status: 'ACTIVE' } }, select: { id: true, circleId: true } });
    if (!post) return NextResponse.json({ error: '帖子不存在或已隐藏。' }, { status: 404 });
    if (!await hasCircleMembership(post.circleId, auth.userId)) return NextResponse.json({ error: '请先订阅该圈子，再发表评论。' }, { status: 403 });
    const limited = postRateLimit(auth.userId, 'comment'); if (limited) return limited;
    const comment = await db.postComment.create({ data: { postId: post.id, authorId: auth.userId, content, imageUrl: image.urls[0] ?? null }, select: { id: true, content: true, imageUrl: true, createdAt: true, updatedAt: true, author: { select: authorSelect } } });
    return NextResponse.json({ comment: { ...comment, author: formatUser(comment.author), isMine: true } }, { status: 201 });
  } catch (error) { logRouteError('POST /api/posts/[id]/comments', error); return NextResponse.json({ error: '评论发布失败，请稍后重试。' }, { status: 500 }); }
}
