import { db } from '@/lib/db';
import { readCommunityRules } from '@/lib/settings';
import { checkRateLimit } from '@/lib/rate-limit';
import { formatUser } from '@/lib/user-identity';

const PAGE_SIZE = 30;
const AUTHOR_SELECT = {id: true, username: true, displayName: true, avatarUrl: true} as const;

export class CharacterCommentError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
    this.name = 'CharacterCommentError';
  }
}

async function requireReadableCharacter(characterId: string, userId?: string) {
  const character = await db.character.findUnique({
    where: {id: characterId},
    select: {id: true, isPublic: true, reviewStatus: true, creatorId: true},
  });
  if (!character) throw new CharacterCommentError('Character not found', 404);
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) {
    throw new CharacterCommentError('Private character access forbidden', 403);
  }
}

function shapeComment(comment: {
  id: string; body: string; likeCount: number; createdAt: Date; updatedAt: Date;
  author: {id: string; username: string; displayName: string | null; avatarUrl: string | null};
}, viewerId: string | undefined, likedIds: Set<string>) {
  return {
    id: comment.id, body: comment.body, likeCount: comment.likeCount,
    createdAt: comment.createdAt, updatedAt: comment.updatedAt,
    author: formatUser(comment.author), isMine: comment.author.id === viewerId, hasLiked: likedIds.has(comment.id),
  };
}

export async function listCharacterComments(characterId: string, viewerId: string | undefined, options: {limit?: number; cursor?: string | null} = {}) {
  await requireReadableCharacter(characterId, viewerId);
  const take = Math.min(PAGE_SIZE, Math.max(1, options.limit || PAGE_SIZE));
  const cursor = options.cursor || undefined;
  const roots = await db.comment.findMany({
    where: {characterId, parentId: null, hiddenAt: null},
    orderBy: {createdAt: 'desc'},
    take: take + 1,
    ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
    select: {
      id: true, body: true, likeCount: true, createdAt: true, updatedAt: true,
      author: {select: AUTHOR_SELECT},
      replies: {
        where: {hiddenAt: null}, orderBy: {createdAt: 'asc'}, take: 10,
        select: {id: true, body: true, likeCount: true, createdAt: true, updatedAt: true, author: {select: AUTHOR_SELECT}},
      },
      _count: {select: {replies: true}},
    },
  });
  const hasMore = roots.length > take;
  const page = hasMore ? roots.slice(0, take) : roots;
  const ids = page.flatMap(comment => [comment.id, ...comment.replies.map(reply => reply.id)]);
  const liked = viewerId && ids.length
    ? await db.commentLike.findMany({where: {userId: viewerId, commentId: {in: ids}}, select: {commentId: true}})
    : [];
  const likedIds = new Set(liked.map(row => row.commentId));

  return {
    comments: page.map(comment => ({
      ...shapeComment(comment, viewerId, likedIds),
      replyCount: comment._count.replies,
      replies: comment.replies.map(reply => shapeComment(reply, viewerId, likedIds)),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function createCharacterComment(authorId: string, characterId: string, input: unknown) {
  await requireReadableCharacter(characterId, authorId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterCommentError('评论数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw new CharacterCommentError('body is required', 400);
  // 字数上限读设置中心（content.comment.maxChars），与帖子评论共用同一项。
  const {commentMaxChars} = await readCommunityRules();
  if (text.length > commentMaxChars) throw new CharacterCommentError(`body must be ${commentMaxChars} characters or fewer`, 400);

  const rawParent = body.parentId ?? body.parent_id;
  let parentId: string | null = null;
  if (typeof rawParent === 'string' && rawParent) {
    const parent = await db.comment.findUnique({where: {id: rawParent}, select: {id: true, characterId: true, parentId: true}});
    if (!parent || parent.characterId !== characterId) throw new CharacterCommentError('Parent comment not found', 404);
    parentId = parent.parentId ?? parent.id;
  }

  // 频率窗口读设置中心（limits.comment.*），与帖子评论共用同一项运营参数。
  const rules = await readCommunityRules();
  const limit = checkRateLimit(`comment:${authorId}`, rules.commentPerWindow, rules.commentWindowMs);
  if (!limit.allowed) throw new CharacterCommentError('评论太频繁了，请稍后再试', 429, limit.retryAfter);

  const comment = await db.comment.create({
    data: {characterId, authorId, parentId, body: text},
    select: {id: true, body: true, parentId: true, likeCount: true, createdAt: true, updatedAt: true, author: {select: AUTHOR_SELECT}},
  });
  return {
    comment: {
      ...shapeComment(comment, authorId, new Set()),
      parentId: comment.parentId,
      replies: [],
      replyCount: 0,
    },
  };
}

export async function updateCharacterComment(authorId: string, commentId: string, input: unknown) {
  const before = await db.comment.findUnique({where: {id: commentId}, select: {authorId: true}});
  if (!before) throw new CharacterCommentError('Comment not found', 404);
  if (before.authorId !== authorId) throw new CharacterCommentError('Forbidden', 403);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterCommentError('评论数据格式不正确。', 400);
  const body = (input as Record<string, unknown>).body;
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new CharacterCommentError('body is required', 400);
  const {commentMaxChars} = await readCommunityRules();
  if (text.length > commentMaxChars) throw new CharacterCommentError(`body must be ${commentMaxChars} characters or fewer`, 400);
  return db.comment.update({
    where: {id: commentId}, data: {body: text},
    select: {id: true, body: true, likeCount: true, createdAt: true, updatedAt: true},
  });
}

export async function deleteCharacterComment(actorId: string, commentId: string) {
  const comment = await db.comment.findUnique({
    where: {id: commentId}, select: {id: true, authorId: true, character: {select: {creatorId: true}}},
  });
  if (!comment) throw new CharacterCommentError('Comment not found', 404);
  const deletedBy = comment.authorId === actorId ? 'author' : comment.character.creatorId === actorId ? 'creator' : null;
  if (!deletedBy) throw new CharacterCommentError('Forbidden', 403);
  await db.comment.delete({where: {id: commentId}});
  return {success: true, deletedBy};
}

export async function likeCharacterComment(userId: string, commentId: string) {
  const comment = await db.comment.findUnique({where: {id: commentId}, select: {id: true}});
  if (!comment) throw new CharacterCommentError('Comment not found', 404);
  const likeCount = await db.$transaction(async tx => {
    const existing = await tx.commentLike.findUnique({where: {userId_commentId: {userId, commentId}}, select: {id: true}});
    if (existing) {
      const current = await tx.comment.findUnique({where: {id: commentId}, select: {likeCount: true}});
      return current?.likeCount ?? 0;
    }
    await tx.commentLike.create({data: {userId, commentId}});
    const updated = await tx.comment.update({where: {id: commentId}, data: {likeCount: {increment: 1}}, select: {likeCount: true}});
    return updated.likeCount;
  });
  return {success: true, hasLiked: true, likeCount};
}

export async function unlikeCharacterComment(userId: string, commentId: string) {
  const likeCount = await db.$transaction(async tx => {
    const existing = await tx.commentLike.findUnique({where: {userId_commentId: {userId, commentId}}, select: {id: true}});
    if (!existing) {
      const current = await tx.comment.findUnique({where: {id: commentId}, select: {likeCount: true}});
      return current?.likeCount ?? null;
    }
    await tx.commentLike.delete({where: {id: existing.id}});
    const updated = await tx.comment.update({where: {id: commentId}, data: {likeCount: {decrement: 1}}, select: {likeCount: true}});
    if (updated.likeCount < 0) {
      const fixed = await tx.comment.update({where: {id: commentId}, data: {likeCount: 0}, select: {likeCount: true}});
      return fixed.likeCount;
    }
    return updated.likeCount;
  });
  if (likeCount === null) throw new CharacterCommentError('Comment not found', 404);
  return {success: true, hasLiked: false, likeCount};
}
