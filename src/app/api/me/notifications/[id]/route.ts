import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {apiError, jsonError, privateHeaders} from '@/lib/http/errors';
import {markNotificationRead} from '@/lib/notifications/service';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

/** 标记单条通知已读；别人的通知返回 404，不泄露存在性。 */
export async function PATCH(request: Request, {params}: Context) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return apiError(401, '请先登录。');
    const {id} = await params;
    return NextResponse.json(await markNotificationRead(auth.userId, id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/me/notifications/[id]', '标记已读失败，请稍后重试。');
  }
}
