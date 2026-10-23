import { NextResponse } from 'next/server';
import { readWeeklyRankings } from '@rumiai/backend/modules/analytics/ranking-service';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readWeeklyRankings());
  } catch (error) {
    logRouteError('GET /api/rankings', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
