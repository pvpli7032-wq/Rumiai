import { NextResponse } from 'next/server';
import { setMediaSessionCookie } from '@/lib/auth-cookies';
import { logRouteError } from '@/lib/logger';
import { signToken, AuthConfigurationError } from '@/lib/auth';
import { formatUser } from '@/lib/user-identity';
import { AccountRegistrationError, registerAccount } from '@/lib/accounts/registration-service';

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      const input: unknown = await request.json();
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return NextResponse.json({ error: '注册数据格式不正确。' }, { status: 400 });
      }
      body = input;
    } catch {
      return NextResponse.json({ error: '注册数据格式不正确。' }, { status: 400 });
    }
    const user = await registerAccount(body);

    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
    return setMediaSessionCookie(NextResponse.json({ user: formatUser(user), token }, { status: 201 }), token);
  } catch (error) {
    if (error instanceof AccountRegistrationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AuthConfigurationError) return NextResponse.json({ error: '账号服务尚未配置，请联系管理员。' }, { status: 503 });
    logRouteError('POST /api/auth/register', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
