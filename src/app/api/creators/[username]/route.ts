import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { formatUser } from '@/lib/user-identity';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * A creator's public profile, addressed by @handle the way the chat panel links to it
 * (/profile/{username}). Only public characters are listed: a creator's private drafts
 * are not part of their public page.
 */
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    const creator = await db.user.findFirst({
      where: { username: params.username, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        tier: true,
        followerCount: true,
        createdAt: true,
      },
    });
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    const [characters, followerCount, isFollowing] = await Promise.all([db.character.findMany({
      where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
      orderBy: { chatCount: 'desc' },
      take: 60,
      select: {
        id: true,
        name: true,
        tagline: true,
        avatarUrl: true,
        chatCount: true,
        likeCount: true,
        messageCount: true,
        tags: true,
        isAdult: true,
      },
    }), db.follow.count({ where: { followingId: creator.id } }), auth && auth.userId !== creator.id ? db.follow.findUnique({ where: { followerId_followingId: { followerId: auth.userId, followingId: creator.id } }, select: { followerId: true } }) : Promise.resolve(null)]);

    // User.characterCount / messageCount / chatCount are dead columns — nothing
    // increments them, so every row reads 0. Serving them would put a wrong number on
    // the page, so the totals are aggregated from the characters instead. `characters`
    // above is capped at 60, so its length is not the total either.
    const totals = await db.character.aggregate({
      where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
      _count: { _all: true },
      _sum: { chatCount: true, messageCount: true, likeCount: true },
    });

    return NextResponse.json({
      creator: {
        ...formatUser(creator),
        followerCount,
        isFollowing: Boolean(isFollowing),
        publicCharacterCount: totals._count._all,
        chatCount: totals._sum.chatCount ?? 0,
        messageCount: totals._sum.messageCount ?? 0,
        likeCount: totals._sum.likeCount ?? 0,
      },
      characters,
    });
  } catch (error) {
    logRouteError('GET /api/creators/[username]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
