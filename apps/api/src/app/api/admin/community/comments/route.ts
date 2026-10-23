import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {listManagedPostComments} from '@rumiai/backend/modules/posts/service';
import {privateHeaders} from '../../_response';
import {postErrorResponse} from '@api/app/api/posts/_response';

export async function GET(request: Request) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const url = new URL(request.url);
    return NextResponse.json(await listManagedPostComments(auth.userId, {q: url.searchParams.get('q') ?? '', status: url.searchParams.get('status') ?? 'ALL', page: Number(url.searchParams.get('page') ?? '1')}), {headers: privateHeaders});
  } catch (error) {return postErrorResponse(error, '评论管理列表加载失败。', 'GET /api/admin/community/comments');}
}
