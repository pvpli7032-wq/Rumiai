import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { signToken, AuthConfigurationError } from '@/lib/auth';
import { formatUser } from '@/lib/user-identity';
import { setMediaSessionCookie } from '@/lib/auth-cookies';

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const input: unknown = await request.json();
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return NextResponse.json({ error: '登录数据格式不正确。' }, { status: 400 });
      }
      body = input as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: '登录数据格式不正确。' }, { status: 400 });
    }
    const password = body.password;
    // Registration stores emails lowercased, so match that here or a user who
    // capitalises anything while typing cannot log in.
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || typeof password !== 'string' || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
    const { passwordHash: _, ...safeUser } = user;
    return setMediaSessionCookie(NextResponse.json({ user: formatUser(safeUser), token }), token);
  } catch (error) {
    if (error instanceof AuthConfigurationError) return NextResponse.json({ error: '账号服务尚未配置，请联系管理员。' }, { status: 503 });
    logRouteError('POST /api/auth/login', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
