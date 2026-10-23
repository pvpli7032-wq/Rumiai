import {NextResponse} from 'next/server';
import {getAdminAuthUser, readAdminSessionState} from '@rumiai/backend/modules/admin-auth/service';
import {readAdminSessionCookie} from '@rumiai/backend/modules/admin-auth/cookies';

export async function GET(request: Request) {
  const user = await getAdminAuthUser(readAdminSessionCookie(request));
  if (!user) return NextResponse.json({error: '请先登录后台。'}, {status: 401, headers: {'Cache-Control': 'private, no-store'}});
  const state = await readAdminSessionState(user.userId);
  if (!state) return NextResponse.json({error: '当前账号没有管理权限。'}, {status: 403, headers: {'Cache-Control': 'private, no-store'}});
  return NextResponse.json(state, {headers: {'Cache-Control': 'private, no-store'}});
}
