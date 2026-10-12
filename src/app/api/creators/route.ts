import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';

/**
 * Reads live data, so it must not be statically prerendered — Next otherwise
 * freezes the build-time response and serves it forever.
 */
export const dynamic = 'force-dynamic';

/** Sort keys accepted by the "ครีเอเตอร์" tab. */
const SORTS = {
  popularByFollowerCount: { followerCount: 'desc' },
  popularByMessageCount: { messageCount: 'desc' },
  popularByChatCount: { chatCount: 'desc' },
  popularByUniverseMessageCount: { universeMessageCount: 'desc' },
  popularByUniverseChatCount: { universeChatCount: 'desc' },
  trendingByFollowerCount: { weeklyFollowerGain: 'desc' },
} as const;

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('sort') ?? 'popularByFollowerCount';
    const orderBy = SORTS[key as keyof typeof SORTS] ?? SORTS.popularByFollowerCount;

    const creators = await db.user.findMany({
      where: { characterCount: { gt: 0 }, deletedAt: null },
      orderBy: [orderBy, { followerCount: 'desc' }],
      take: 50,
      select: {
        id: true, username: true, displayName: true, avatarUrl: true, tier: true,
        followerCount: true, characterCount: true, messageCount: true, chatCount: true,
        universeMessageCount: true, universeChatCount: true, weeklyFollowerGain: true,
      },
    });

    return NextResponse.json(creators.map((c, i) => ({ rank: i + 1, ...c })));
  } catch (error) {
    logRouteError('GET /api/creators', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
