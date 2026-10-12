import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
    const [banners, tags, badges, sections] = await Promise.all([
      db.banner.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      db.tag.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.badge.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.homeSection.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

    return NextResponse.json({
      banners: {
        hero: banners.filter((b) => b.placement === 'HERO'),
        sidebar: banners.filter((b) => b.placement === 'SIDEBAR'),
      },
      tags,
      badges,
      sections,
    });
  } catch (error) {
    logRouteError('GET /api/site', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
