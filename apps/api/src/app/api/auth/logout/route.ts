import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { setMediaSessionCookie } from '@rumiai/backend/infrastructure/auth/auth-cookies';
import { revokeAllSessions } from '@rumiai/backend/modules/accounts/session-service';

/**
 * Signs the caller out everywhere.
 *
 * Clearing the token client-side left it valid for the rest of its seven days, so a
 * leaked token survived logging out. Bumping tokenVersion invalidates every token
 * issued for this account, on every device — which is the behaviour a user expects
 * from "sign out" after losing a phone.
 */
export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tokenVersion = await revokeAllSessions(authUser.userId);
    return setMediaSessionCookie(NextResponse.json({ success: true, tokenVersion }), null);
  } catch (error) {
    logRouteError('POST /api/auth/logout', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
