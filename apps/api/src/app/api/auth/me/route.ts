import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { AccountProfileError, readOwnProfile } from '@rumiai/backend/modules/accounts/profile-service';

export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({ user: await readOwnProfile(authUser.userId) });
  } catch (error) {
    if (error instanceof AccountProfileError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
