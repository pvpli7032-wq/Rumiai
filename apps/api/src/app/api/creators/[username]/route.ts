import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { CreatorReadError, readCreatorProfile } from '@rumiai/backend/modules/creators/read-service';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const { username } = await paramsPromise;
  try {
    const auth = await getAuthUser(request);
    return NextResponse.json(await readCreatorProfile(username, auth?.userId));
  } catch (error) {
    if (error instanceof CreatorReadError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('GET /api/creators/[username]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
