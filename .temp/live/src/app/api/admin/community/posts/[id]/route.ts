import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {managePost} from '@/lib/posts/service';
import {privateHeaders} from '../../../_response';
import {postErrorResponse, readJson} from '@/app/api/posts/_response';

export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const parsed = await readJson(request, 20_000); if (parsed.response) return parsed.response;
    return NextResponse.json(await managePost(auth.userId, (await params).id, parsed.input), {headers: privateHeaders});
  } catch (error) {return postErrorResponse(error, '帖子管理操作失败。', 'PATCH /api/admin/community/posts/[id]');}
}
