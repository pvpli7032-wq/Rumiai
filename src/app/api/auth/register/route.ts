import { NextResponse } from 'next/server';
import { setMediaSessionCookie } from '@/lib/auth-cookies';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { signToken, ensureAuthSigningConfiguration, AuthConfigurationError } from '@/lib/auth';
import { allocateHandle, formatUser, isUniqueViolation } from '@/lib/user-identity';

/** Matches the check in src/app/register/page.tsx. */
const MIN_PASSWORD_LENGTH = 6;
/** bcrypt only hashes the first 72 bytes. */
const MAX_PASSWORD_BYTES = 72;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    // An explicit `username` is a handle the user picked; `name` is a display name.
    const requestedHandle = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : '';

    if (!email || !password || (!requestedHandle && !displayName)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The register page enforced this client-side only, so posting straight to the
    // API accepted a one-character password.
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }
    // bcrypt silently ignores bytes past 72, which would make a long password
    // weaker than it looks; reject rather than truncate.
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      return NextResponse.json({ error: 'Password is too long' }, { status: 400 });
    }

    ensureAuthSigningConfiguration();
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    let username: string;
    if (requestedHandle) {
      // The user asked for this handle, so a collision is an error rather than
      // something to silently rename around.
      if (await db.user.findUnique({ where: { username: requestedHandle }, select: { id: true } })) {
        return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
      }
      username = requestedHandle;
    } else {
      // Derive from the email local-part, which is already unique, so two people
      // sharing a display name never blocks a signup.
      username = await allocateHandle(email.split('@')[0]);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: {
        username,
        displayName: displayName || null,
        email,
        passwordHash,
        coins: 100,
        tier: 'ROOKIE',
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        tokenVersion: true,
        email: true,
        avatarUrl: true,
        tier: true,
        coins: true,
        streakCount: true,
        createdAt: true,
      },
    });

    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
    return setMediaSessionCookie(NextResponse.json({ user: formatUser(user), token }, { status: 201 }), token);
  } catch (error) {
    if (error instanceof AuthConfigurationError) return NextResponse.json({ error: '账号服务尚未配置，请联系管理员。' }, { status: 503 });
    // Concurrent signups can both pass the checks above and collide at insert time.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'Email or username already in use' }, { status: 409 });
    }
    logRouteError('POST /api/auth/register', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
