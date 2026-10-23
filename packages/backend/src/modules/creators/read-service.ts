import { db } from '@rumiai/backend/infrastructure/database/client';
import { formatUser } from '@rumiai/backend/infrastructure/auth/user-identity';

export class CreatorReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CreatorReadError';
  }
}

const creatorSorts = {
  popularByFollowerCount: { followerCount: 'desc' },
  popularByMessageCount: { messageCount: 'desc' },
  popularByChatCount: { chatCount: 'desc' },
  popularByUniverseMessageCount: { universeMessageCount: 'desc' },
  popularByUniverseChatCount: { universeChatCount: 'desc' },
  trendingByFollowerCount: { weeklyFollowerGain: 'desc' },
} as const;

export async function listCreators(sort: string | null) {
  const orderBy = creatorSorts[sort as keyof typeof creatorSorts] ?? creatorSorts.popularByFollowerCount;
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
  return creators.map((creator, index) => ({ rank: index + 1, ...creator }));
}

export async function readCreatorProfile(username: string, viewerId?: string) {
  const creator = await db.user.findFirst({
    where: { username, deletedAt: null },
    select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true, followerCount: true, createdAt: true },
  });
  if (!creator) throw new CreatorReadError('Creator not found', 404);

  const [characters, followerCount, isFollowing, totals] = await Promise.all([
    db.character.findMany({
      where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
      orderBy: { chatCount: 'desc' }, take: 60,
      select: { id: true, name: true, tagline: true, avatarUrl: true, chatCount: true, likeCount: true, messageCount: true, tags: true, isAdult: true },
    }),
    db.follow.count({ where: { followingId: creator.id } }),
    viewerId && viewerId !== creator.id
      ? db.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: creator.id } }, select: { followerId: true } })
      : Promise.resolve(null),
    db.character.aggregate({
      where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
      _count: { _all: true }, _sum: { chatCount: true, messageCount: true, likeCount: true },
    }),
  ]);

  return {
    creator: {
      ...formatUser(creator), followerCount, isFollowing: Boolean(isFollowing),
      publicCharacterCount: totals._count._all,
      chatCount: totals._sum.chatCount ?? 0,
      messageCount: totals._sum.messageCount ?? 0,
      likeCount: totals._sum.likeCount ?? 0,
    },
    characters,
  };
}

export async function listCreatorActivity(username: string, take: number, cursor: string | null) {
  const creator = await db.user.findUnique({ where: { username }, select: { id: true } });
  if (!creator) throw new CreatorReadError('创作者不存在。', 404);
  const posts = await db.post.findMany({
    where: { authorId: creator.id, status: 'VISIBLE', circle: { status: 'ACTIVE' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, content: true, createdAt: true,
      media: { orderBy: { position: 'asc' }, select: { url: true } },
      circle: { select: { id: true, name: true } },
      character: { select: { id: true, name: true, isPublic: true, reviewStatus: true } },
      _count: { select: { comments: { where: { status: 'VISIBLE' } } } },
    },
  });
  const hasMore = posts.length > take;
  const page = hasMore ? posts.slice(0, take) : posts;
  return {
    posts: page.map(post => ({
      id: post.id, content: post.content, createdAt: post.createdAt,
      images: post.media.map(image => image.url), circle: post.circle,
      character: post.character?.isPublic && post.character.reviewStatus === 'APPROVED'
        ? { id: post.character.id, name: post.character.name }
        : null,
      commentCount: post._count.comments,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function listCreatorConnections(
  username: string,
  type: 'followers' | 'following',
  take: number,
  cursor: string | null,
) {
  const creator = await db.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (!creator) throw new CreatorReadError('创作者不存在。', 404);
  const where = type === 'followers' ? { followingId: creator.id } : { followerId: creator.id };
  const rows = await db.follow.findMany({
    where, orderBy: [{ createdAt: 'desc' }, { followerId: 'asc' }], take: take + 1,
    ...(cursor ? {
      cursor: { followerId_followingId: type === 'followers'
        ? { followerId: cursor, followingId: creator.id }
        : { followerId: creator.id, followingId: cursor } }, skip: 1,
    } : {}),
    select: {
      followerId: true, followingId: true, createdAt: true,
      follower: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      following: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    type,
    users: page.map(row => ({ ...formatUser(type === 'followers' ? row.follower : row.following), followedAt: row.createdAt })),
    total: await db.follow.count({ where }),
    nextCursor: hasMore ? (type === 'followers' ? page[page.length - 1].followerId : page[page.length - 1].followingId) : null,
  };
}
