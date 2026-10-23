import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { listCreators } from '@rumiai/backend/modules/creators/read-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const sort = new URL(request.url).searchParams.get('sort');
    return NextResponse.json(await listCreators(sort));
  } catch (error) {
    logRouteError('GET /api/creators', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
