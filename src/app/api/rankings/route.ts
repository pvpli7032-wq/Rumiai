import { NextResponse } from 'next/server';
import { readWeeklyRankings } from '@/lib/analytics/ranking-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readWeeklyRankings());
  } catch (error) {
    logRouteError('GET /api/rankings', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
