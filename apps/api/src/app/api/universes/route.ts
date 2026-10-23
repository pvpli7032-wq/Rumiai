import { NextResponse } from 'next/server';
import { listPublicUniverses } from '@rumiai/backend/modules/discovery/read-service';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listPublicUniverses());
  } catch (error) {
    logRouteError('GET /api/universes', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
