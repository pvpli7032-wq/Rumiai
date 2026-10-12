import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { formatUser, isUniqueViolation } from '@/lib/user-identity';

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  avatarUrl: true,
  tier: true,
  coins: true,
  streakCount: true,
  lastCheckin: true,
  bannedWords: true,
  readingMode: true,
  shortcuts: true,
  createdAt: true,
} as const;

export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: authUser.userId },
      select: USER_SELECT,
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const formattedUser = formatUser(user);
    return NextResponse.json({ user: formattedUser, ...formattedUser });
  } catch (error) {
    logRouteError('GET /api/users/me', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    // `name` edits the free-text display name. Changing the unique @handle needs
    // an explicit `username`, so renaming a profile can never collide with
    // someone else's handle.
    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : undefined;
    const username = typeof body.username === 'string' ? body.username.trim() : undefined;
    const avatarUrl = body.avatarUrl ?? body.avatar_url;
    // Reader preferences from the chat panel. bannedWords is newline-separated so a
    // phrase can contain a comma; shortcuts is opaque JSON owned by the client.
    const bannedWords =
      typeof (body.bannedWords ?? body.banned_words) === 'string'
        ? (body.bannedWords ?? body.banned_words).slice(0, 4_000)
        : undefined;
    const readingMode =
      typeof (body.readingMode ?? body.reading_mode) === 'boolean'
        ? (body.readingMode ?? body.reading_mode)
        : undefined;
    let shortcuts: string | undefined;
    if (body.shortcuts !== undefined) {
      const raw = typeof body.shortcuts === 'string' ? body.shortcuts : JSON.stringify(body.shortcuts);
      if (raw.length > 4_000) {
        return NextResponse.json({ error: 'shortcuts is too large' }, { status: 400 });
      }
      try {
        JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'shortcuts must be valid JSON' }, { status: 400 });
      }
      shortcuts = raw;
    }

    if (username !== undefined && username.length === 0) {
      return NextResponse.json({ error: 'Username cannot be empty' }, { status: 400 });
    }
    if (displayName !== undefined && displayName.length === 0) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    const user = await db.user.update({
      where: { id: authUser.userId },
      data: {
        ...(username !== undefined && { username }),
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bannedWords !== undefined && { bannedWords }),
        ...(readingMode !== undefined && { readingMode }),
        ...(shortcuts !== undefined && { shortcuts }),
      },
      select: USER_SELECT,
    });
    const formattedUser = formatUser(user);
    return NextResponse.json({ user: formattedUser, ...formattedUser });
  } catch (error) {
    // A taken @handle is the caller's mistake, not a server fault.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
