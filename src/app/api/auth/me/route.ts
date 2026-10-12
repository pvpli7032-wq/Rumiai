import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { formatUser } from '@/lib/user-identity';

export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: authUser.userId },
      select: {
        id: true, username: true, displayName: true, email: true, avatarUrl: true,
        tier: true, coins: true, streakCount: true, lastCheckin: true, createdAt: true,
        // The client context is populated from here, and the chat reads the reader's
        // preferences off it. Without these the settings saved on the profile page had no
        // effect until a full reload picked them up from somewhere else.
        readingMode: true, bannedWords: true, shortcuts: true,
      },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ user: formatUser(user) });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
