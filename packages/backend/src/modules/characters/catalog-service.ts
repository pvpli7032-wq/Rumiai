import { db } from '@rumiai/backend/infrastructure/database/client';
import { countOpenCharacterReports } from '@rumiai/backend/modules/characters/report-summary';

export class CharacterCatalogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CharacterCatalogError';
  }
}

export async function readCharacterDetail(characterId: string, viewerId?: string) {
  const character = await db.character.findUnique({
    where: {id: characterId},
    include: {
      creator: {select: {id: true, username: true, displayName: true, avatarUrl: true}},
      images: {orderBy: {sortOrder: 'asc'}, select: {id: true, url: true, sortOrder: true}},
      emojis: {orderBy: {sortOrder: 'asc'}, select: {id: true, emotion: true, url: true}},
      supportCast: {orderBy: {sortOrder: 'asc'}, select: {id: true, name: true, avatarUrl: true, description: true}},
    },
  });
  if (!character) throw new CharacterCatalogError('Character not found', 404);
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== viewerId) {
    throw new CharacterCatalogError('Private character access forbidden', 403);
  }
  const [liked, bookmarked] = viewerId
    ? await Promise.all([
        db.characterLike.findUnique({where: {userId_characterId: {userId: viewerId, characterId}}, select: {id: true}}),
        db.characterBookmark.findUnique({where: {userId_characterId: {userId: viewerId, characterId}}, select: {id: true}}),
      ])
    : [null, null];
  return {...character, viewer: {hasLiked: Boolean(liked), hasBookmarked: Boolean(bookmarked)}};
}

export async function readPublicCharacter(characterId: string) {
  return db.character.findFirst({
    where: {id: characterId, isPublic: true, reviewStatus: 'APPROVED'},
    select: {
      id: true, name: true, tagline: true, greeting: true, personality: true, avatarUrl: true, chatCount: true, tags: true,
      creator: {select: {username: true, displayName: true}},
    },
  });
}

export async function resolveCharacterTagLabels(tagValue: string | null) {
  const keys = (tagValue ?? '').split(',').map(key => key.trim()).filter(Boolean);
  if (!keys.length) return [];
  const rows = await db.tag.findMany({where: {key: {in: keys}}, select: {key: true, label: true}});
  const labels = new Map(rows.map(row => [row.key, row.label]));
  return keys.map(key => labels.get(key) ?? key);
}

export async function listPublicCharacterPosts(characterId: string) {
  return db.post.findMany({
    where: {characterId, status: 'VISIBLE', circle: {status: 'ACTIVE'}},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 10,
    select: {id: true, content: true, createdAt: true, circle: {select: {id: true, name: true}}},
  });
}

export async function listCharacters(options: {
  search?: string; scope?: string | null; sort?: string; tags?: string[]; userId?: string;
  exclusive?: boolean; limit?: number; after?: {id: string; chatCount: number; createdAt: string};
}) {
  const {search = '', scope = null, sort = 'popular', tags = [], userId, after} = options;
  if (search.length > 200) throw new CharacterCatalogError('搜索词过长。', 400);
  if (tags.length > 10) throw new CharacterCatalogError('最多同时筛选10个标签。', 400);
  if (scope && !['mine', 'bookmarked', 'following'].includes(scope)) throw new CharacterCatalogError('未知角色列表类型。', 400);
  if (scope && !userId) throw new CharacterCatalogError('请先登录。', 401);
  if (!['new', 'popular'].includes(sort)) throw new CharacterCatalogError('未知排序方式。', 400);

  const normalizedTags = tags.filter(Boolean).slice(0, 10);
  const characters = await db.character.findMany({
    where: {
      ...(scope === 'mine' ? {creatorId: userId} : {isPublic: true, reviewStatus: 'APPROVED'}),
      ...(options.exclusive !== undefined ? {isExclusive: options.exclusive} : {}),
      ...(scope === 'bookmarked' && {bookmarks: {some: {userId}}}),
      // 关注的创作者：只取已公开且审核通过的角色，关注关系挂在创作者身上。
      ...(scope === 'following' && {creator: {followers: {some: {followerId: userId}}}}),
      AND: [
        ...normalizedTags.map(tag => ({OR: [
          {tags: tag}, {tags: {startsWith: tag + ','}}, {tags: {endsWith: ',' + tag}}, {tags: {contains: ',' + tag + ','}},
        ]})),
        ...(after ? [sort === 'new' ? {OR: [
          {createdAt: {lt: new Date(after.createdAt)}},
          {createdAt: new Date(after.createdAt), id: {gt: after.id}},
        ]} : {OR: [
          {chatCount: {lt: after.chatCount}},
          {chatCount: after.chatCount, id: {gt: after.id}},
        ]}] : []),
      ],
      ...(search && {OR: [{name: {contains: search}}, {tagline: {contains: search}}]}),
    },
    orderBy: sort === 'new' ? [{createdAt: 'desc'}, {id: 'asc'}] : [{chatCount: 'desc'}, {id: 'asc'}],
    take: options.limit ?? (scope ? 100 : 50),
    select: {
      id: true, name: true, tagline: true, personality: true, background: true, greeting: true, avatarUrl: true,
      creatorId: true, isPublic: true, publicationRequested: true, reviewStatus: true, reviewReason: true,
      copyrightStatement: true, chatCount: true, likeCount: true, isExclusive: true, badges: true, tags: true, createdAt: true,
      creator: {select: {username: true, displayName: true}},
    },
  });
  if (scope !== 'mine') return characters;
  const reports = await countOpenCharacterReports(db, characters.map(character => character.id));
  return characters.map(character => ({...character, openReportCount: reports.get(character.id) ?? 0}));
}


/** Explicit pagination keeps existing array callers compatible. */
export async function readCharacterCatalogPage(options: Parameters<typeof listCharacters>[0] & {cursor?: string | null}) {
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CharacterCatalogError('每页数量须为1至50。', 400);
  let after: {id: string; chatCount: number; createdAt: string} | undefined;
  if (options.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 150 ||
        typeof parsed.chatCount !== 'number' || !Number.isFinite(parsed.chatCount) || parsed.chatCount < 0 ||
        typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))) throw Error();
      after = parsed;
    } catch { throw new CharacterCatalogError('分页游标不正确，请重新搜索。', 400); }
  }
  const rows = await listCharacters({...options, limit: limit + 1, after});
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items, hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({id: last.id, chatCount: last.chatCount, createdAt: last.createdAt.toISOString()})).toString('base64url') : null,
  };
}
