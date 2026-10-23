import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {createPost, listCirclePosts} from '@rumiai/backend/modules/posts/service';
import {postErrorResponse, readJson} from '@api/app/api/posts/_response';
import {formatUser} from '@rumiai/backend/infrastructure/auth/user-identity';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params, url = new URL(request.url), auth = await getAuthUser(request);
    const result = await listCirclePosts(id, {limit: Number(url.searchParams.get('limit')) || 20, cursor: url.searchParams.get('cursor')});
    return NextResponse.json({posts: result.items.map(row => ({id: row.id, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, author: formatUser(row.author), isMine: row.authorId === auth?.userId, images: row.images, character: row.character, commentCount: row.commentCount, isPinned: row.isPinned, isFeatured: row.isFeatured})), nextCursor: result.nextCursor}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return postErrorResponse(error, '帖子加载失败，请稍后重试。', 'GET /api/circles/[id]/posts');}
}
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    const {id} = await params, post = await createPost(auth.userId, id, parsed.input);
    return NextResponse.json({post: {id: post.id, content: post.content, createdAt: post.createdAt, updatedAt: post.updatedAt, author: formatUser(post.author), isMine: true, images: post.media.map(media => media.url), character: post.character, commentCount: post._count.comments}}, {status: 201});
  } catch (error) {return postErrorResponse(error, '帖子发布失败，请稍后重试。', 'POST /api/circles/[id]/posts');}
}
