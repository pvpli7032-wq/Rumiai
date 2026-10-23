import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';
import {CircleError} from './errors';
import {validateCircleContent, validateCircleUniverse} from './content';
const circleSelect = (userId: string | null) => ({
  id: true, name: true, description: true, tags: true, createdAt: true, isFeatured: true,
  owner: {select: {id: true, username: true, displayName: true}},
  universe: {select: {id: true, name: true, isPublic: true}},
  _count: {select: {members: true}},
  members: {where: {userId: userId ?? ''}, select: {userId: true}},
} as const);
type CircleRow = Prisma.CircleGetPayload<{select: ReturnType<typeof circleSelect>}>;
function publicCircle(row: CircleRow) {
  const {members, _count, universe, ...circle} = row;
  return {...circle, universe: universe?.isPublic ? {id: universe.id, name: universe.name} : null, subscriberCount: _count.members, subscribed: !!members.length};
}
function rateLimit(userId: string, action: 'create' | 'membership') {
  const result = checkRateLimit(`circle:${action}:${userId}`, action === 'create' ? 5 : 60, 60_000);
  if (!result.allowed) throw new CircleError('操作太频繁，请稍后重试。', 429, result.retryAfter);
}
async function claimActiveUser(tx: Prisma.TransactionClient, userId: string) {
  const claimed = await tx.user.updateMany({where: {id: userId, deletedAt: null, suspendedAt: null}, data: {accountVersion: {increment: 0}}});
  if (!claimed.count) throw new CircleError('账号不可用，请重新登录。', 401);
}
export async function listCircles(userId: string | null, query: {scope?: string | null; search?: string}) {
  const scope = query.scope, search = query.search?.trim() ?? '';
  if (scope && !['mine', 'subscribed'].includes(scope)) throw new CircleError('未知圈子列表类型。');
  if (scope && !userId) throw new CircleError('请先登录。', 401);
  if (search.length > 100) throw new CircleError('搜索文字不能超过 100 字符。');
  const rows = await db.circle.findMany({where: {status: 'ACTIVE', ...(scope === 'mine' ? {ownerId: userId!} : {}), ...(scope === 'subscribed' ? {members: {some: {userId: userId!}}} : {}), ...(search ? {OR: [{name: {contains: search}}, {description: {contains: search}}, {tags: {contains: search}}]} : {})}, select: circleSelect(userId), orderBy: [{isFeatured: 'desc'}, {createdAt: 'desc'}, {id: 'asc'}], take: 100});
  return rows.map(publicCircle);
}
export async function readCircle(userId: string | null, id: string) {
  const circle = await db.circle.findFirst({where: {id, status: 'ACTIVE'}, select: circleSelect(userId)});
  if (!circle) throw new CircleError('圈子不存在或已隐藏。', 404);
  return publicCircle(circle);
}
export async function createCircle(userId: string, input: unknown) {
  const data = validateCircleContent(input);
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimActiveUser(tx, userId);
    const author = await tx.user.findUniqueOrThrow({where: {id: userId}, select: {communityBannedAt: true, communityBanReason: true}});
    if (author.communityBannedAt) throw new CircleError('你的社区发言权限暂时受限。可在社区申诉入口提交复核。', 403, undefined, author.communityBanReason);
    await validateCircleUniverse(tx, data.universeId);
    rateLimit(userId, 'create');
    return publicCircle(await tx.circle.create({data: {...data, ownerId: userId}, select: circleSelect(userId)}));
  });
}
export async function changeCircleSubscription(userId: string, circleId: string, subscribe: boolean) {
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimActiveUser(tx, userId);
    if (!await tx.circle.findFirst({where: {id: circleId, status: 'ACTIVE'}, select: {id: true}})) throw new CircleError('圈子不存在或已隐藏。', 404);
    if (subscribe) {
      const restriction = await tx.circleMembershipRestriction.findUnique({where: {circleId_userId: {circleId, userId}}, select: {reason: true}});
      if (restriction) throw new CircleError('你暂时不能加入该圈子，请联系运营人员。', 403, undefined, restriction.reason);
    }
    rateLimit(userId, 'membership');
    if (subscribe) await tx.circleMember.upsert({where: {circleId_userId: {circleId, userId}}, create: {circleId, userId}, update: {}});
    else await tx.circleMember.deleteMany({where: {circleId, userId}});
    return {subscribed: subscribe, subscriberCount: await tx.circleMember.count({where: {circleId}})};
  });
}
