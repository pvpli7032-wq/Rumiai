import { NextResponse } from 'next/server';
import {readPublicSiteContent} from '@/lib/site-content/public-service';
import { logRouteError } from '@/lib/logger';

/**
 * Reads live data, so it must not be statically prerendered — Next otherwise
 * freezes the build-time response and serves it forever.
 */
export const dynamic = 'force-dynamic';

/**
 * Everything the shell and explore page need to render, in one round trip:
 * banners, the tag catalog, card badges and the configured rails.
 */
export async function GET() {
  try {
    return NextResponse.json(await readPublicSiteContent(), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    logRouteError('GET /api/site', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
