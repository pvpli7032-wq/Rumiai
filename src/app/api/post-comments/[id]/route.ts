import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { parseCommunityBody, POST_COMMENT_MAX_CHARS, validatePostImages } from '@/lib/community-posts';

export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const comment = await db.postComment.findUnique({ where: { id: params.id }, select: { id: true, authorId: true, status: true } });
    if (!comment) return NextResponse.json({ error: '评论不存在。' }, { status: 404 });
    if (comment.authorId !== auth.userId) return NextResponse.json({ error: '只能编辑自己的评论。' }, { status: 403 });
    if (comment.status !== 'VISIBLE') return NextResponse.json({ error: '评论已隐藏，无法编辑。' }, { status: 409 });
    const sizeError = parseCommunityBody(request, 20_000); if (sizeError) return sizeError.response;
    let input; try { input = await request.json(); } catch { return NextResponse.json({ error: '评论数据格式不正确。' }, { status: 400 }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '评论数据格式不正确。' }, { status: 400 });
    const content = typeof input.content === 'string' ? input.content.trim() : '', imageUrl = input.imageUrl === undefined || input.imageUrl === null || input.imageUrl === '' ? null : input.imageUrl;
    if (!content && !imageUrl) return NextResponse.json({ error: '请填写评论或添加图片。' }, { status: 400 });
    if (content.length > POST_COMMENT_MAX_CHARS) return NextResponse.json({ error: `评论不能超过 ${POST_COMMENT_MAX_CHARS} 字符。` }, { status: 400 });
    const image = imageUrl === null ? { urls: [] as string[] } : await validatePostImages([imageUrl], auth.userId);
    if ('error' in image) return NextResponse.json({ error: image.error }, { status: 400 });
    const updated = await db.postComment.update({ where: { id: comment.id }, data: { content, imageUrl: image.urls[0] ?? null }, select: { id: true, content: true, imageUrl: true, updatedAt: true } });
    return NextResponse.json({ comment: updated });
  } catch (error) { logRouteError('PATCH /api/post-comments/[id]', error); return NextResponse.json({ error: '评论保存失败，请稍后重试。' }, { status: 500 }); }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const comment = await db.postComment.findUnique({ where: { id: params.id }, select: { id: true, authorId: true } });
    if (!comment) return NextResponse.json({ error: '评论不存在。' }, { status: 404 });
    if (comment.authorId !== auth.userId) return NextResponse.json({ error: '只能删除自己的评论。' }, { status: 403 });
    await db.postComment.delete({ where: { id: comment.id } });
    return NextResponse.json({ success: true });
  } catch (error) { logRouteError('DELETE /api/post-comments/[id]', error); return NextResponse.json({ error: '评论删除失败，请稍后重试。' }, { status: 500 }); }
}
