import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';

/**
 * Reads live data, so it must not be statically prerendered — Next otherwise
 * freezes the build-time response and serves it forever.
 */
export const dynamic = 'force-dynamic';

/** Public worlds for the explore page's "จักรวาล" tab. */
export async function GET() {
  try {
    const universes = await db.universe.findMany({
      where: { isPublic: true },
      orderBy: { chatCount: 'desc' },
      take: 50,
      select: {
        id: true, name: true, tagline: true, description: true, imageUrl: true,
        characterCount: true, chatCount: true, tags: true, createdAt: true,
      },
    });
    return NextResponse.json(universes);
  } catch (error) {
    logRouteError('GET /api/universes', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
