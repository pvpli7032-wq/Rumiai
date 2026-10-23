import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {readCommunityRestriction} from '@rumiai/backend/modules/community/restriction-service';
import {claimCircleManager, readManagementCommand, requireCircleManagement} from '@rumiai/backend/modules/circles/management-access';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {notifyReply} from '@rumiai/backend/modules/notifications/write';
import {notifySafely} from '@rumiai/backend/modules/notifications/emit';
import {PostManagementError} from './errors';
import {claimPostRateLimit, validatePostComment, validatePostContent, validatePostImages} from './validation';

const authorSelect = {id: true, username: true, displayName: true, avatarUrl: true} as const;
const postSelect = {id: true, circleId: true, authorId: true, content: true, status: true, isPinned: true, isFeatured: true, createdAt: true, updatedAt: true, author: {select: authorSelect}, circle: {select: {id: true, name: true}}, media: {orderBy: {position: 'asc'}, select: {id: true, url: true, position: true}}, character: {select: {id: true, name: true, isPublic: true, reviewStatus: true}}, _count: {select: {comments: {where: {status: 'VISIBLE'}}}}} as const;

function postError(message: string, status = 400): never { throw new PostManagementError(message, status); }
function version(input: unknown) {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) postError('内容版本无效，请刷新后重试。');
  return Date.parse(input);
}
function nextVersion(previous: Date) { return new Date(Math.max(Date.now(), previous.getTime() + 1)); }
/** 社区写入前的账号校验：账号未注销未封禁，且没有被社区禁言。与 admin 的管理员写锁无关。 */
async function requireCommunityWriter(tx: Prisma.TransactionClient, userId: string) {
  const result = await tx.user.updateMany({where: {id: userId, deletedAt: null, suspendedAt: null}, data: {tokenVersion: {increment: 0}}});
  if (!result.count) postError('账号当前无法发布社区内容。', 403);
  if ((await readCommunityRestriction(userId, tx))?.communityBannedAt) postError('你的社区发言权限暂时受限。', 403);
}
async function requireMembership(tx: Prisma.TransactionClient, circleId: string, userId: string) {
  const circle = await tx.circle.findFirst({where: {id: circleId, status: 'ACTIVE'}, select: {id: true}});
  if (!circle) postError('圈子不存在或已隐藏。', 404);
  if (!await tx.circleMember.findUnique({where: {circleId_userId: {circleId, userId}}, select: {userId: true}})) postError('请先订阅该圈子，再发布社区内容。', 403);
  if (await tx.circleMembershipRestriction.findUnique({where: {circleId_userId: {circleId, userId}}, select: {userId: true}})) postError('你暂时无法在该圈子发言。', 403);
}
export async function hasCircleMembership(circleId: string, userId: string) {
  const member = await db.circleMember.findFirst({where: {circleId, userId, circle: {status: 'ACTIVE'}}, select: {userId: true}});
  return Boolean(member && !await db.circleMembershipRestriction.findUnique({where: {circleId_userId: {circleId, userId}}, select: {userId: true}}));
}

export async function listCirclePosts(circleId: string, query: {limit?: number; cursor?: string | null}) {
  const take = Math.min(30, Math.max(1, Number(query.limit) || 20));
  const circle = await db.circle.findFirst({where: {id: circleId, status: 'ACTIVE'}, select: {id: true}});
  if (!circle) postError('圈子不存在或已隐藏。', 404);
  const rows = await db.post.findMany({where: {circleId, status: 'VISIBLE'}, orderBy: [{isPinned: 'desc'}, {isFeatured: 'desc'}, {createdAt: 'desc'}, {id: 'desc'}], take: take + 1, ...(query.cursor ? {cursor: {id: query.cursor}, skip: 1} : {}), select: postSelect});
  const hasMore = rows.length > take, items = hasMore ? rows.slice(0, take) : rows;
  return {items: items.map(row => ({...row, images: row.media.map(media => media.url), media: undefined, character: row.character?.isPublic && row.character.reviewStatus === 'APPROVED' ? {id: row.character.id, name: row.character.name} : null, commentCount: row._count.comments})), nextCursor: hasMore ? items.at(-1)!.id : null};
}
export async function listPostComments(postId: string, query: {limit?: number; cursor?: string | null}) {
  if (!await db.post.findFirst({where: {id: postId, status: 'VISIBLE', circle: {status: 'ACTIVE'}}, select: {id: true}})) postError('帖子不存在或已隐藏。', 404);
  const take = Math.min(50, Math.max(1, Number(query.limit) || 30));
  const rows = await db.postComment.findMany({where: {postId, status: 'VISIBLE'}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}], take: take + 1, ...(query.cursor ? {cursor: {id: query.cursor}, skip: 1} : {}), select: {id: true, content: true, imageUrl: true, createdAt: true, updatedAt: true, authorId: true, author: {select: authorSelect}}});
  const hasMore = rows.length > take, items = hasMore ? rows.slice(0, take) : rows;
  return {items, nextCursor: hasMore ? items.at(-1)!.id : null};
}
export async function createPost(userId: string, circleId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) postError('帖子数据格式不正确。');
  const body = input as Record<string, unknown>, content = await validatePostContent(body.content), characterId = body.characterId == null || body.characterId === '' ? null : typeof body.characterId === 'string' ? body.characterId : postError('关联角色无效。');
  await claimPostRateLimit(userId, 'post'); await pragmasReady;
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId); await requireMembership(tx, circleId, userId);
    if (characterId && !await tx.character.findFirst({where: {id: characterId, isPublic: true, reviewStatus: 'APPROVED'}, select: {id: true}})) postError('只能关联已审核通过的公开角色。');
    const images = await validatePostImages(body.images, userId, tx);
    return tx.post.create({data: {circleId, authorId: userId, content, characterId, media: {create: images.map((url, position) => ({url, position}))}}, select: postSelect});
  });
}
export async function editPost(userId: string, postId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) postError('帖子数据格式不正确。');
  const body = input as Record<string, unknown>, expected = version(body.updatedAt), content = await validatePostContent(body.content);
  const characterId = body.characterId === undefined ? undefined : body.characterId == null || body.characterId === '' ? null : typeof body.characterId === 'string' ? body.characterId : postError('关联角色无效。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId);
    const post = await tx.post.findUnique({where: {id: postId}, select: {authorId: true, status: true, updatedAt: true, circleId: true}});
    if (!post) postError('帖子不存在。', 404); if (post.authorId !== userId) postError('只能编辑自己的帖子。', 403); if (post.status !== 'VISIBLE') postError('帖子已隐藏，无法编辑。', 409); if (post.updatedAt.getTime() !== expected) postError('帖子已被修改，请刷新后重试。', 409);
    await requireMembership(tx, post.circleId, userId);
    if (typeof characterId === 'string' && !await tx.character.findFirst({where: {id: characterId, isPublic: true, reviewStatus: 'APPROVED'}, select: {id: true}})) postError('只能关联已审核通过的公开角色。');
    const images = await validatePostImages(body.images, userId, tx), updatedAt = nextVersion(post.updatedAt);
    await tx.post.update({where: {id: postId}, data: {content, ...(characterId !== undefined ? {characterId} : {}), updatedAt}});
    await tx.postMedia.deleteMany({where: {postId}});
    if (images.length) await tx.postMedia.createMany({data: images.map((url, position) => ({postId, url, position}))});
    return tx.post.findUniqueOrThrow({where: {id: postId}, select: postSelect});
  });
}
export async function deletePost(userId: string, postId: string, expectedValue: unknown) {
  const expected = version(expectedValue);
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId);
    const post = await tx.post.findUnique({where: {id: postId}, select: {authorId: true, status: true, updatedAt: true}});
    if (!post) postError('帖子不存在。', 404); if (post.authorId !== userId) postError('只能删除自己的帖子。', 403); if (post.status === 'DELETED') return {success: true}; if (post.updatedAt.getTime() !== expected) postError('帖子已被修改，请刷新后重试。', 409);
    await tx.postMedia.deleteMany({where: {postId}});
    const updatedAt = nextVersion(post.updatedAt);
    await tx.postComment.updateMany({where: {postId}, data: {content: '', imageUrl: null, status: 'DELETED', updatedAt}});
    await tx.post.update({where: {id: postId}, data: {content: '', characterId: null, status: 'DELETED', isPinned: false, isFeatured: false, updatedAt}});
    return {success: true};
  });
}
export async function createPostComment(userId: string, postId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) postError('评论数据格式不正确。');
  const body = input as Record<string, unknown>, {content, imageUrl} = await validatePostComment(body.content, body.imageUrl);
  await claimPostRateLimit(userId, 'comment'); await pragmasReady;
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId);
    const post = await tx.post.findFirst({where: {id: postId, status: 'VISIBLE', circle: {status: 'ACTIVE'}}, select: {id: true, circleId: true, authorId: true}});
    if (!post) postError('帖子不存在或已隐藏。', 404); await requireMembership(tx, post.circleId, userId);
    if (imageUrl) await validatePostImages([imageUrl], userId, tx);
    const comment = await tx.postComment.create({data: {postId, authorId: userId, content, imageUrl}, select: {id: true, content: true, imageUrl: true, createdAt: true, updatedAt: true, authorId: true, author: {select: authorSelect}}});
    return {comment, post};
  }).then(async ({comment, post}) => {
    // 回复提醒：评论落库（事务提交）之后才写，自己评论自己的帖子不通知（V3 §26）。
    if (post.authorId !== userId) {
      const replierName = comment.author.displayName || comment.author.username;
      await notifySafely(() => notifyReply({
        userId: post.authorId, replyId: comment.id, replierName, excerpt: content,
        targetType: 'POST', targetId: post.circleId + ':' + post.id,
      }), 'post_comment_reply');
    }
    return comment;
  });
}
export async function editPostComment(userId: string, commentId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) postError('评论数据格式不正确。');
  const body = input as Record<string, unknown>, expected = version(body.updatedAt), {content, imageUrl} = await validatePostComment(body.content, body.imageUrl);
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId);
    const comment = await tx.postComment.findUnique({where: {id: commentId}, select: {authorId: true, status: true, updatedAt: true, post: {select: {status: true, circleId: true, circle: {select: {status: true}}}}}});
    if (!comment) postError('评论不存在。', 404); if (comment.authorId !== userId) postError('只能编辑自己的评论。', 403); if (comment.status !== 'VISIBLE' || comment.post.status !== 'VISIBLE' || comment.post.circle.status !== 'ACTIVE') postError('评论已隐藏，无法编辑。', 409); if (comment.updatedAt.getTime() !== expected) postError('评论已被修改，请刷新后重试。', 409);
    await requireMembership(tx, comment.post.circleId, userId);
    if (imageUrl) await validatePostImages([imageUrl], userId, tx);
    return tx.postComment.update({where: {id: commentId}, data: {content, imageUrl, updatedAt: nextVersion(comment.updatedAt)}, select: {id: true, content: true, imageUrl: true, updatedAt: true}});
  });
}
export async function deletePostComment(userId: string, commentId: string, expectedValue: unknown) {
  const expected = version(expectedValue);
  return db.$transaction(async tx => {
    await requireCommunityWriter(tx, userId);
    const comment = await tx.postComment.findUnique({where: {id: commentId}, select: {authorId: true, status: true, updatedAt: true}});
    if (!comment) postError('评论不存在。', 404); if (comment.authorId !== userId) postError('只能删除自己的评论。', 403); if (comment.updatedAt.getTime() !== expected) postError('评论已被修改，请刷新后重试。', 409);
    await tx.postComment.update({where: {id: commentId}, data: {content: '', imageUrl: null, status: 'DELETED', updatedAt: nextVersion(comment.updatedAt)}});
    return {success: true};
  });
}

export async function setContentVisibilityFromReport(tx: Prisma.TransactionClient, type: 'POST' | 'COMMENT', targetId: string, visible: boolean) {
  const status = visible ? 'VISIBLE' : 'HIDDEN';
  if (type === 'POST') {
    const before = await tx.post.findFirst({where: {id: targetId, status: {not: 'DELETED'}}, select: {updatedAt: true}});
    if (!before) return {count: 0};
    return tx.post.updateMany({where: {id: targetId, status: {not: 'DELETED'}}, data: {status, ...(!visible ? {isPinned: false, isFeatured: false} : {}), updatedAt: nextVersion(before.updatedAt)}});
  }
  const before = await tx.postComment.findFirst({where: {id: targetId, status: {not: 'DELETED'}}, select: {updatedAt: true}});
  if (!before) return {count: 0};
  return tx.postComment.updateMany({where: {id: targetId, status: {not: 'DELETED'}}, data: {status, updatedAt: nextVersion(before.updatedAt)}});
}

export async function listManagedPosts(actor: string, query: {q?: string; status?: string; circleId?: string; page?: number}) {
  const {q = '', status = 'ALL', circleId, page = 1} = query;
  if (q.length > 100 || !['ALL', 'VISIBLE', 'HIDDEN', 'DELETED'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000) postError('帖子查询条件无效。');
  const where: Prisma.PostWhereInput = {...(status !== 'ALL' ? {status} : {}), ...(circleId ? {circleId} : {}), ...(q.trim() ? {OR: [{id: q.trim()}, {content: {contains: q.trim()}}, {author: {OR: [{username: {contains: q.trim()}}, {displayName: {contains: q.trim()}}]}}, {circle: {name: {contains: q.trim()}}}]} : {})};
  return db.$transaction(async tx => { await requireCircleManagement(actor, 'community.read', tx); const [items, total] = await Promise.all([tx.post.findMany({where, select: postSelect, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.post.count({where})]); return {items, total, page, pageSize: 25}; });
}
export async function managePost(actor: string, postId: string, input: unknown) {
  const {body, reason, expected} = readManagementCommand(input, true), action = body.action;
  if (!['HIDE', 'RESTORE', 'PIN', 'UNPIN', 'FEATURE', 'UNFEATURE', 'DELETE'].includes(action as string)) postError('帖子管理动作无效。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimCircleManager(tx, actor, 'community.write');
    const before = await tx.post.findUnique({where: {id: postId}, select: postSelect}); if (!before) postError('帖子不存在。', 404); if (before.status === 'DELETED') postError('已清除的帖子不能恢复或修改。', 409); if (before.updatedAt.getTime() !== expected) postError('帖子已被修改，请刷新后重试。', 409);
    if (['PIN', 'FEATURE'].includes(action as string) && before.status !== 'VISIBLE') postError('仅可对公开帖子执行置顶或推荐。', 409);
    if (action === 'HIDE' && before.status !== 'VISIBLE' || action === 'RESTORE' && before.status !== 'HIDDEN' || action === 'PIN' && before.isPinned || action === 'UNPIN' && !before.isPinned || action === 'FEATURE' && before.isFeatured || action === 'UNFEATURE' && !before.isFeatured) postError('帖子状态已变化，请刷新后重试。', 409);
    const updatedAt = nextVersion(before.updatedAt);
    const data = action === 'HIDE' ? {status: 'HIDDEN', isPinned: false, isFeatured: false, updatedAt} : action === 'RESTORE' ? {status: 'VISIBLE', updatedAt} : action === 'PIN' ? {isPinned: true, updatedAt} : action === 'UNPIN' ? {isPinned: false, updatedAt} : action === 'FEATURE' ? {isFeatured: true, updatedAt} : action === 'UNFEATURE' ? {isFeatured: false, updatedAt} : {content: '', characterId: null, status: 'DELETED', isPinned: false, isFeatured: false, updatedAt};
    if (action === 'DELETE') { await tx.postMedia.deleteMany({where: {postId}}); await tx.postComment.updateMany({where: {postId}, data: {content: '', imageUrl: null, status: 'DELETED', updatedAt}}); }
    const saved = await tx.post.update({where: {id: postId}, data, select: postSelect});
    await recordAdminAudit(tx, actor, `COMMUNITY_POST_${action}`, postId, reason, {circleId: before.circleId, status: before.status, isPinned: before.isPinned, isFeatured: before.isFeatured, updatedAt: before.updatedAt});
    return saved;
  });
}

export async function listManagedPostComments(actor: string, query: {q?: string; status?: string; page?: number}) {
  const {q = '', status = 'ALL', page = 1} = query;
  if (q.length > 100 || !['ALL', 'VISIBLE', 'HIDDEN', 'DELETED'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000) postError('评论查询条件无效。');
  const where: Prisma.PostCommentWhereInput = {...(status !== 'ALL' ? {status} : {}), ...(q.trim() ? {OR: [{id: q.trim()}, {content: {contains: q.trim()}}, {author: {OR: [{username: {contains: q.trim()}}, {displayName: {contains: q.trim()}}]}}, {post: {OR: [{id: q.trim()}, {circle: {name: {contains: q.trim()}}}]}}]} : {})};
  return db.$transaction(async tx => {
    await requireCircleManagement(actor, 'community.read', tx);
    const select = {id: true, postId: true, content: true, imageUrl: true, status: true, createdAt: true, updatedAt: true, author: {select: authorSelect}, post: {select: {id: true, circle: {select: {id: true, name: true}}}}} as const;
    const [items, total] = await Promise.all([tx.postComment.findMany({where, select, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.postComment.count({where})]);
    return {items, total, page, pageSize: 25};
  });
}
export async function managePostComment(actor: string, commentId: string, input: unknown) {
  const {body, reason, expected} = readManagementCommand(input, true), action = body.action;
  if (!['HIDE', 'RESTORE', 'DELETE'].includes(action as string)) postError('评论管理动作无效。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimCircleManager(tx, actor, 'community.write');
    const before = await tx.postComment.findUnique({where: {id: commentId}, select: {postId: true, content: true, imageUrl: true, status: true, updatedAt: true}});
    if (!before) postError('评论不存在。', 404); if (before.status === 'DELETED') postError('已清除的评论不能恢复或修改。', 409); if (before.updatedAt.getTime() !== expected) postError('评论已被修改，请刷新后重试。', 409);
    if (action === 'HIDE' && before.status !== 'VISIBLE' || action === 'RESTORE' && before.status !== 'HIDDEN') postError('评论状态已变化，请刷新后重试。', 409);
    const updatedAt = nextVersion(before.updatedAt), data = action === 'DELETE' ? {content: '', imageUrl: null, status: 'DELETED', updatedAt} : {status: action === 'HIDE' ? 'HIDDEN' : 'VISIBLE', updatedAt};
    const saved = await tx.postComment.update({where: {id: commentId}, data, select: {id: true, postId: true, content: true, imageUrl: true, status: true, updatedAt: true}});
    await recordAdminAudit(tx, actor, `COMMUNITY_COMMENT_${action}`, commentId, reason, {postId: before.postId, status: before.status, updatedAt: before.updatedAt, hadImage: Boolean(before.imageUrl), contentLength: before.content.length});
    return saved;
  });
}
