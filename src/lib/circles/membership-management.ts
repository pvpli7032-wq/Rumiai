import {db, pragmasReady} from '@/lib/db';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {CircleError} from './errors';
import {claimCircleManager, readManagementCommand, requireCircleManagement} from './management-access';

const userProjection = {id: true, username: true, displayName: true, deletedAt: true, suspendedAt: true} as const;
export async function listManagedCircleMembers(actor: string, circleId: string, query: {q?: string; status?: string; page?: number}) {
  const {q = '', status = 'MEMBER', page = 1} = query;
  if (q.length > 100 || !['MEMBER', 'BLOCKED'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new CircleError('成员查询条件无效。');
  const where = {circleId, ...(q.trim() ? {user: {OR: [{id: q.trim()}, {username: {contains: q.trim()}}, {displayName: {contains: q.trim()}}]}} : {})};
  return db.$transaction(async tx => {
    await requireCircleManagement(actor, 'community.read', tx);
    if (!await tx.circle.findUnique({where: {id: circleId}, select: {id: true}})) throw new CircleError('圈子不存在。', 404);
    if (status === 'BLOCKED') {
      const [rows, total] = await Promise.all([tx.circleMembershipRestriction.findMany({where, select: {userId: true, reason: true, createdAt: true, updatedAt: true, user: {select: userProjection}}, orderBy: [{createdAt: 'desc'}, {userId: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.circleMembershipRestriction.count({where})]);
      return {items: rows.map(row => ({...row, status})), total, page, pageSize: 25};
    }
    const [rows, total] = await Promise.all([tx.circleMember.findMany({where, select: {userId: true, createdAt: true, user: {select: userProjection}}, orderBy: [{createdAt: 'desc'}, {userId: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.circleMember.count({where})]);
    return {items: rows.map(row => ({...row, status, updatedAt: row.createdAt, reason: null})), total, page, pageSize: 25};
  });
}
export async function manageCircleMember(actor: string, circleId: string, userId: string, input: unknown) {
  const {body, reason, expected} = readManagementCommand(input, true);
  const action = body.action;
  if (!['REMOVE', 'BLOCK', 'UNBLOCK'].includes(action as string)) throw new CircleError('成员管理动作无效。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimCircleManager(tx, actor, 'community.members.manage');
    if (!await tx.circle.findUnique({where: {id: circleId}, select: {id: true}})) throw new CircleError('圈子不存在。', 404);
    const user = await tx.user.findUnique({where: {id: userId}, select: {deletedAt: true}});
    if (!user || user.deletedAt) throw new CircleError('账号不存在或已注销。', 404);
    const key = {circleId_userId: {circleId, userId}};
    const membership = await tx.circleMember.findUnique({where: key, select: {createdAt: true}});
    const restriction = await tx.circleMembershipRestriction.findUnique({where: key, select: {updatedAt: true}});
    if (action === 'UNBLOCK') {
      if (!restriction || restriction.updatedAt.getTime() !== expected) throw new CircleError('限制记录已变化，请刷新后重试。', 409);
      await tx.circleMembershipRestriction.delete({where: key});
    } else {
      if (!membership || membership.createdAt.getTime() !== expected || restriction) throw new CircleError('成员状态已变化，请刷新后重试。', 409);
      await tx.circleMember.delete({where: key});
      if (action === 'BLOCK') await tx.circleMembershipRestriction.create({data: {circleId, userId, actorId: actor, reason}});
    }
    await recordAdminAudit(tx, actor, `CIRCLE_MEMBER_${action}`, circleId, reason, {userId, before: action === 'UNBLOCK' ? 'BLOCKED' : 'MEMBER', after: action === 'BLOCK' ? 'BLOCKED' : 'NOT_JOINED'});
    return {success: true};
  });
}
