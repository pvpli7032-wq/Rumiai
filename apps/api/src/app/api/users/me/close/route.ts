import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { closeAccount, AccountClosureError } from '@rumiai/backend/modules/accounts/closure-service';
import { checkRateLimit } from '@rumiai/backend/infrastructure/http/rate-limit';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { setMediaSessionCookie } from '@rumiai/backend/infrastructure/auth/auth-cookies';

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const limit = checkRateLimit(`account-close:${user.userId}`, 5, 60000);
    if (!limit.allowed) return NextResponse.json({ error: '尝试次数过多，请稍后再试。' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '注销数据格式错误。' }, { status: 400 }); }
    return setMediaSessionCookie(NextResponse.json(await closeAccount(user.userId, body), { headers: { 'Cache-Control': 'private, no-store' } }), null);
  } catch (error) {
    if (error instanceof AccountClosureError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('POST /api/users/me/close', error);
    return NextResponse.json({ error: '注销未完成，请重新登录后核对状态。' }, { status: 500 });
  }
}
