import { NextResponse } from 'next/server';
import { listPublicUniverses } from '@/lib/discovery/read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listPublicUniverses());
  } catch (error) {
    logRouteError('GET /api/universes', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
