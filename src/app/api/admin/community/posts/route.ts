import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {listManagedPosts} from '@/lib/posts/service';
import {privateHeaders} from '../../_response';
import {postErrorResponse} from '@/app/api/posts/_response';

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const url = new URL(request.url);
    return NextResponse.json(await listManagedPosts(auth.userId, {q: url.searchParams.get('q') ?? '', status: url.searchParams.get('status') ?? 'ALL', circleId: url.searchParams.get('circleId') ?? undefined, page: Number(url.searchParams.get('page') ?? '1')}), {headers: privateHeaders});
  } catch (error) {return postErrorResponse(error, '帖子管理列表加载失败。', 'GET /api/admin/community/posts');}
}
