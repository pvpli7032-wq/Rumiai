import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {assertAccountSuspensionAllowed, assertAdministrativeAccountManagementAllowed, parseUtcDayRange, recordAdminAudit, AdminManagementError} from '@/lib/admin/management-service';
import {setCommunityRestriction} from '@/lib/community/restriction-service';
import type {AdminPermission} from '@/lib/admin/permissions';

export class AccountManagementError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
const accountSelection = {id: true, username: true, displayName: true, email: true, avatarUrl: true, coins: true, tier: true, createdAt: true, lastLoginAt: true, lastActiveAt: true, suspendedAt: true, suspensionReason: true, deletedAt: true, communityBannedAt: true, communityBanReason: true, accountVersion: true} as const;
async function requirePermission(actorId: string, permission: AdminPermission, tx: Prisma.TransactionClient = db) {
  if (!await hasAdminPermission(actorId, permission, tx)) throw new AccountManagementError('当前账号没有此用户管理权限。', 403);
}
function id(value: string) {if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new AccountManagementError('用户编号无效。'); return value;}

/**
 * Resolve the active account reference for account-owned subdomains.
 *
 * The settings routes used to repeat this lookup (and its deleted-account
 * rule) in each HTTP handler. The route owns URL decoding; this domain function
 * owns the account lookup and the rule that deleted accounts are not active.
 */
export async function readActiveAccountReference(userId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(userId)) return null;
  const user = await db.user.findUnique({where: {id: userId}, select: {id: true, deletedAt: true}});
  return user && !user.deletedAt ? {id: user.id} : null;
}

/** from / until 按注册日期（createdAt）筛，UTC 日边界，含结束日期当天。 */
export async function listManagedAccounts(actorId: string, params: {q?: string; status?: string; community?: string; page?: number; sort?: string; from?: string; until?: string}) {
  await requirePermission(actorId, 'accounts.read');
  const {q = '', status = 'ALL', community = 'ALL', page = 1, sort = 'NEWEST'} = params;
  const registered = parseUtcDayRange(params.from, params.until, '用户注册日期', message => new AccountManagementError(message));
  if (q.length > 100 || !['ALL', 'ACTIVE', 'SUSPENDED', 'CLOSED'].includes(status) || !['ALL', 'BANNED', 'CLEAR'].includes(community) || !['NEWEST', 'OLDEST', 'ACTIVE'].includes(sort) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AccountManagementError('用户查询条件无效。');
  const where: Prisma.UserWhereInput = {...(q.trim() ? {OR: [{id: q.trim()}, {username: {contains: q.trim()}}, {email: {contains: q.trim()}}, {displayName: {contains: q.trim()}}]} : {}), ...(status === 'ACTIVE' ? {deletedAt: null, suspendedAt: null} : status === 'SUSPENDED' ? {deletedAt: null, suspendedAt: {not: null}} : status === 'CLOSED' ? {deletedAt: {not: null}} : {}), ...(community === 'BANNED' ? {communityBannedAt: {not: null}} : community === 'CLEAR' ? {communityBannedAt: null} : {}), ...(registered.gte || registered.lt ? {createdAt: registered} : {})};
  return db.$transaction(async tx => {
    await requirePermission(actorId, 'accounts.read', tx);
    const [items, total] = await Promise.all([tx.user.findMany({where, select: accountSelection, orderBy: [{[sort === 'ACTIVE' ? 'lastActiveAt' : 'createdAt']: sort === 'OLDEST' ? 'asc' : 'desc'}, {id: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.user.count({where})]);
    return {items, total, page, pageSize: 25};
  });
}

export async function readManagedAccount(actorId: string, userId: string) {
  id(userId); await requirePermission(actorId, 'accounts.read');
  return db.$transaction(async tx => {
    await requirePermission(actorId, 'accounts.read', tx);
    const user = await tx.user.findUnique({where: {id: userId}, select: {...accountSelection, _count: {select: {characters: true, conversations: true, posts: true, paymentOrders: true, reportsFiled: true}}}});
    if (!user) throw new AccountManagementError('用户不存在。', 404);
    const canReadFinance = await hasAdminPermission(actorId, 'finance.read', tx);
    const [characters, orders, ledger, activity] = await Promise.all([
      tx.character.findMany({where: {creatorId: userId}, select: {id: true, name: true, reviewStatus: true, isPublic: true, createdAt: true}, orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: 20}),
      tx.paymentOrder.findMany({where: {userId}, select: {orderNo: true, status: true, coinAmount: true, amountCnyCents: true, createdAt: true, paidAt: true}, orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: 20}),
      canReadFinance ? tx.coinTransaction.findMany({where: {userId}, select: {id: true, type: true, amount: true, createdAt: true}, orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: 20}) : null,
      tx.adminAuditLog.findMany({where: {targetId: userId, action: {startsWith: 'ACCOUNT_'}}, select: {id: true, action: true, reason: true, actorId: true, createdAt: true}, orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: 20}),
    ]);
    return {user, characters, orders, ledger, activity, canReadFinance, relatedLimit: 20};
  });
}

const actions = {SUSPEND: 'accounts.manage', RESTORE: 'accounts.manage', REVOKE_SESSIONS: 'accounts.sessions.revoke', BAN_COMMUNITY: 'accounts.community.manage', UNBAN_COMMUNITY: 'accounts.community.manage'} as const;
export async function updateManagedAccount(actorId: string, userId: string, input: unknown) {
  id(userId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountManagementError('用户操作数据格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.action !== 'string' || !Object.hasOwn(actions, body.action) || !Number.isSafeInteger(body.version) || (body.version as number) < 0 || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new AccountManagementError('请选择有效操作，填写理由并携带当前版本。');
  const action = body.action as keyof typeof actions, reason = body.reason.trim();
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actorId}`;
    await requirePermission(actorId, actions[action], tx);
    const before = await tx.user.findUnique({where: {id: userId}, select: accountSelection});
    if (!before || before.deletedAt) throw new AccountManagementError('用户不存在或已注销，不能执行此操作。', 404);
    if (before.accountVersion !== body.version) throw new AccountManagementError('用户状态已被修改，请刷新后重试。', 409);
    if (action === 'SUSPEND') {
      if (before.suspendedAt) throw new AccountManagementError('账号已经停用。', 409);
      try {await assertAccountSuspensionAllowed(tx, actorId, userId);} catch (error) {if (error instanceof AdminManagementError) throw new AccountManagementError(error.message, error.status); throw error;}
      if (actorId === userId) throw new AccountManagementError('不能在当前会话中停用自己的账号。', 409);
      await tx.user.update({where: {id: userId}, data: {suspendedAt: new Date(), suspensionReason: reason, tokenVersion: {increment: 1}, accountVersion: {increment: 1}}});
      await tx.adminSession.deleteMany({where: {userId}});
    } else if (action === 'RESTORE') {
      if (!before.suspendedAt) throw new AccountManagementError('账号当前未停用。', 409);
      try {await assertAdministrativeAccountManagementAllowed(tx, actorId, userId);} catch (error) {if (error instanceof AdminManagementError) throw new AccountManagementError(error.message, error.status); throw error;}
      await tx.user.update({where: {id: userId}, data: {suspendedAt: null, suspensionReason: null, accountVersion: {increment: 1}}});
    } else if (action === 'REVOKE_SESSIONS') {
      try {await assertAdministrativeAccountManagementAllowed(tx, actorId, userId);} catch (error) {if (error instanceof AdminManagementError) throw new AccountManagementError(error.message, error.status); throw error;}
      await tx.user.update({where: {id: userId}, data: {tokenVersion: {increment: 1}, accountVersion: {increment: 1}}});
      // Frontend JWTs are invalidated by tokenVersion; admin sessions are
      // opaque rows and must be revoked explicitly in the same transaction.
      await tx.adminSession.deleteMany({where: {userId}});
    } else {
      if ((action === 'BAN_COMMUNITY') === Boolean(before.communityBannedAt)) throw new AccountManagementError(action === 'BAN_COMMUNITY' ? '用户已经被社区禁言。' : '用户当前未被社区禁言。', 409);
      await setCommunityRestriction(tx, userId, action === 'BAN_COMMUNITY', reason);
      await tx.moderationAction.create({data: {actorId, targetType: 'USER', targetId: userId, action: action === 'BAN_COMMUNITY' ? 'BAN' : 'UNBAN', reason}});
    }
    const after = await tx.user.findUniqueOrThrow({where: {id: userId}, select: accountSelection});
    await recordAdminAudit(tx, actorId, `ACCOUNT_${action}`, userId, reason, {before: {suspendedAt: before.suspendedAt, communityBannedAt: before.communityBannedAt, version: before.accountVersion}, after: {suspendedAt: after.suspendedAt, communityBannedAt: after.communityBannedAt, version: after.accountVersion}});
    return after;
  });
}
