import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {apiError, jsonError, privateHeaders} from '@/lib/http/errors';
import {listNotifications, markAllNotificationsRead} from '@/lib/notifications/service';

export const dynamic = 'force-dynamic';

/** 当前用户的通知列表 + 未读计数。私有数据，任何响应都不许被中间层缓存。 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return apiError(401, '请先登录。');
    const {searchParams} = new URL(request.url);
    const take = Number(searchParams.get('take') ?? '');
    const page = await listNotifications(auth.userId, {
      cursor: searchParams.get('cursor'),
      take: Number.isFinite(take) && take > 0 ? take : undefined,
    });
    return NextResponse.json(page, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/me/notifications', '读取通知失败，请稍后重试。');
  }
}

/** 全部标记已读。 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return apiError(401, '请先登录。');
    return NextResponse.json(await markAllNotificationsRead(auth.userId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/me/notifications', '标记已读失败，请稍后重试。');
  }
}
