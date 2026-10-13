import {NextResponse} from 'next/server';
import {loginWithPassword, AccountLoginError} from '@/lib/accounts/login-service';
import {AuthConfigurationError} from '@/lib/auth';
import {setMediaSessionCookie} from '@/lib/auth-cookies';
import {logRouteError} from '@/lib/logger';
export async function POST(request: Request) {
  try {
    const result = await loginWithPassword(await request.json().catch(() => null));
    return setMediaSessionCookie(NextResponse.json(result), result.token);
  } catch (error) {
    if (error instanceof AccountLoginError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof AuthConfigurationError) return NextResponse.json({error: '账号服务尚未配置，请联系管理员。'}, {status: 503});
    logRouteError('POST /api/auth/login', error);
    return NextResponse.json({error: '登录失败，请稍后重试。'}, {status: 500});
  }
}
