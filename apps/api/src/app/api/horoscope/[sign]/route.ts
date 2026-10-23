import { NextResponse } from 'next/server';
import { DiscoveryReadError, readHoroscope } from '@rumiai/backend/modules/discovery/read-service';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export async function GET(_request: Request, {params: paramsPromise}: {params: Promise<{sign: string}>}) {
  const {sign} = await paramsPromise;
  try {
    return NextResponse.json(await readHoroscope(sign));
  } catch (error) {
    if (error instanceof DiscoveryReadError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET /api/horoscope/[sign]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
