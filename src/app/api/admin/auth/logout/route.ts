import {NextResponse} from 'next/server';
import {revokeAdminSession} from '@/lib/admin-auth/service';
import {isAdminOriginAllowed, readAdminSessionCookie, setAdminSessionCookie} from '@/lib/admin-auth/cookies';
import {privateHeaders, jsonError} from '@/lib/http/errors';

export async function POST(request: Request) {
  if (!isAdminOriginAllowed(request)) return NextResponse.json({error: '后台请求来源不正确。'}, {status: 403});
  try {
    await revokeAdminSession(readAdminSessionCookie(request));
    return setAdminSessionCookie(NextResponse.json({success: true}, {headers: privateHeaders}), null);
  } catch (error) { return jsonError(error, 'POST /api/admin/auth/logout', '退出后台失败，请重试。'); }
}
