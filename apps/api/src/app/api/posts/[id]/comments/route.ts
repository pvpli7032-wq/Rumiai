import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {createPostComment, listPostComments} from '@rumiai/backend/modules/posts/service';
import {postErrorResponse, readJson} from '@api/app/api/posts/_response';
import {formatUser} from '@rumiai/backend/infrastructure/auth/user-identity';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params, url = new URL(request.url), auth = await getAuthUser(request), result = await listPostComments(id, {limit: Number(url.searchParams.get('limit')) || 30, cursor: url.searchParams.get('cursor')});
    return NextResponse.json({comments: result.items.map(comment => ({id: comment.id, content: comment.content, imageUrl: comment.imageUrl, createdAt: comment.createdAt, updatedAt: comment.updatedAt, author: formatUser(comment.author), isMine: comment.authorId === auth?.userId})), nextCursor: result.nextCursor}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return postErrorResponse(error, '评论加载失败，请稍后重试。', 'GET /api/posts/[id]/comments');}
}
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request, 20_000); if (parsed.response) return parsed.response;
    const comment = await createPostComment(auth.userId, (await params).id, parsed.input);
    return NextResponse.json({comment: {id: comment.id, content: comment.content, imageUrl: comment.imageUrl, createdAt: comment.createdAt, updatedAt: comment.updatedAt, author: formatUser(comment.author), isMine: true}}, {status: 201});
  } catch (error) {return postErrorResponse(error, '评论发布失败，请稍后重试。', 'POST /api/posts/[id]/comments');}
}
