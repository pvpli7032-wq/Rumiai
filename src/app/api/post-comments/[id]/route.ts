import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {deletePostComment, editPostComment} from '@/lib/posts/service';
import {postErrorResponse, readJson} from '@/app/api/posts/_response';

export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request, 20_000); if (parsed.response) return parsed.response;
    return NextResponse.json({comment: await editPostComment(auth.userId, (await params).id, parsed.input)});
  } catch (error) {return postErrorResponse(error, '评论保存失败，请稍后重试。', 'PATCH /api/post-comments/[id]');}
}
export async function DELETE(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request, 20_000); if (parsed.response) return parsed.response;
    const body = parsed.input && typeof parsed.input === 'object' ? (parsed.input as Record<string, unknown>) : null;
    if (!body) return NextResponse.json({error: '请求数据格式不正确。'}, {status: 400});
    return NextResponse.json(await deletePostComment(auth.userId, (await params).id, body.updatedAt));
  } catch (error) {return postErrorResponse(error, '评论删除失败，请稍后重试。', 'DELETE /api/post-comments/[id]');}
}
