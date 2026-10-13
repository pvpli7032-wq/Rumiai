import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readAdminAccess} from '@/lib/admin/access-service';
import {logRouteError} from '@/lib/logger';

export async function GET(request: Request) {
  const headers = {'Cache-Control': 'private, no-store'};
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers});
    return NextResponse.json(readAdminAccess(user.userId), {headers});
  } catch (error) {
    logRouteError('GET /api/admin/access', error);
    return NextResponse.json({error: '管理权限读取失败，请稍后重试。'}, {status: 500, headers});
  }
}
