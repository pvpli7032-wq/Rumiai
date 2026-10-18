import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {deletePost, editPost} from '@/lib/posts/service';
import {postErrorResponse, readJson} from '@/app/api/posts/_response';

export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    const {id} = await params, post = await editPost(auth.userId, id, parsed.input);
    return NextResponse.json({post: {id: post.id, content: post.content, updatedAt: post.updatedAt, character: post.character, images: post.media.map(media => media.url)}});
  } catch (error) {return postErrorResponse(error, '帖子保存失败，请稍后重试。', 'PATCH /api/posts/[id]');}
}
export async function DELETE(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    const body = parsed.input && typeof parsed.input === 'object' ? (parsed.input as Record<string, unknown>) : null;
    if (!body) return NextResponse.json({error: '请求数据格式不正确。'}, {status: 400});
    return NextResponse.json(await deletePost(auth.userId, (await params).id, body.updatedAt));
  } catch (error) {return postErrorResponse(error, '帖子删除失败，请稍后重试。', 'DELETE /api/posts/[id]');}
}
