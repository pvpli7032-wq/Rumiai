import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { parseCommunityBody, POST_MAX_CHARS, validatePostContent, validatePostImages } from '@/lib/community-posts';

export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const post = await db.post.findUnique({ where: { id: params.id }, select: { id: true, authorId: true, status: true } });
    if (!post) return NextResponse.json({ error: '帖子不存在。' }, { status: 404 });
    if (post.authorId !== auth.userId) return NextResponse.json({ error: '只能编辑自己的帖子。' }, { status: 403 });
    if (post.status !== 'VISIBLE') return NextResponse.json({ error: '帖子已隐藏，无法编辑。' }, { status: 409 });
    const sizeError = parseCommunityBody(request); if (sizeError) return sizeError.response;
    let input; try { input = await request.json(); } catch { return NextResponse.json({ error: '帖子数据格式不正确。' }, { status: 400 }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '帖子数据格式不正确。' }, { status: 400 });
    const content = validatePostContent(input.content), images = await validatePostImages(input.images, auth.userId);
    if ('error' in content) return NextResponse.json({ error: content.error }, { status: 400 });
    if ('error' in images) return NextResponse.json({ error: images.error }, { status: 400 });
    const characterId = input.characterId === undefined ? undefined : input.characterId == null || input.characterId === '' ? null : typeof input.characterId === 'string' ? input.characterId : false;
    if (characterId === false) return NextResponse.json({ error: '关联角色无效。' }, { status: 400 });
    if (typeof characterId === 'string' && !await db.character.findFirst({ where: { id: characterId, isPublic: true, reviewStatus: 'APPROVED' }, select: { id: true } })) return NextResponse.json({ error: '只能关联已审核通过的公开角色。' }, { status: 400 });
    const updated = await db.$transaction(async tx => {
      await tx.post.update({ where: { id: post.id }, data: { content: content.content!, ...(characterId !== undefined ? { characterId } : {}) } });
      await tx.postMedia.deleteMany({ where: { postId: post.id } });
      if (images.urls.length) await tx.postMedia.createMany({ data: images.urls.map((url, position) => ({ postId: post.id, url, position })) });
      return tx.post.findUniqueOrThrow({ where: { id: post.id }, select: { id: true, content: true, updatedAt: true, character: { select: { id: true, name: true } }, media: { orderBy: { position: 'asc' }, select: { url: true } } } });
    });
    return NextResponse.json({ post: { ...updated, images: updated.media.map(m => m.url) } });
  } catch (error) { logRouteError('PATCH /api/posts/[id]', error); return NextResponse.json({ error: '帖子保存失败，请稍后重试。' }, { status: 500 }); }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const post = await db.post.findUnique({ where: { id: params.id }, select: { id: true, authorId: true } });
    if (!post) return NextResponse.json({ error: '帖子不存在。' }, { status: 404 });
    if (post.authorId !== auth.userId) return NextResponse.json({ error: '只能删除自己的帖子。' }, { status: 403 });
    await db.post.delete({ where: { id: post.id } });
    return NextResponse.json({ success: true });
  } catch (error) { logRouteError('DELETE /api/posts/[id]', error); return NextResponse.json({ error: '帖子删除失败，请稍后重试。' }, { status: 500 }); }
}
