import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {setCommunityRestriction} from './restriction-service';
import {setContentVisibilityFromReport} from '@/lib/posts/service';

export class CommunityModerationError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
async function claimModerator(tx: Prisma.TransactionClient, actorId: string) {
  await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actorId}`;
  if (!await hasAdminPermission(actorId, 'moderation.write', tx)) throw new CommunityModerationError('此操作仅限审核人员。', 403);
}
function inputObject(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommunityModerationError('处置数据格式不正确。');
  return input as Record<string, unknown>;
}
function explanation(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 1000) throw new CommunityModerationError('请填写原因，最多1000字。');
  return input.trim();
}
export async function moderateCommunityReport(actorId: string, reportId: string, input: unknown) {
  const body = inputObject(input), reason = explanation(body.reason);
  if (typeof body.action !== 'string' || !['REVIEWING', 'DISMISS', 'HIDE', 'RESTORE', 'BAN', 'UNBAN'].includes(body.action)) throw new CommunityModerationError('请选择有效处置动作。');
  const action = body.action;
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimModerator(tx, actorId);
    const report = await tx.report.findUnique({where: {id: reportId}, select: {id: true, targetType: true, targetId: true, status: true}});
    if (!report) throw new CommunityModerationError('举报记录不存在。', 404);
    if (['ACTIONED', 'DISMISSED'].includes(report.status) && !['REVIEWING', 'UNBAN'].includes(action)) throw new CommunityModerationError('该举报已结案，请查看审计记录。', 409);
    if (['HIDE', 'RESTORE'].includes(action) && !['POST', 'POST_COMMENT'].includes(report.targetType)) throw new CommunityModerationError('当前举报目标不支持此内容处置。');
    if (['BAN', 'UNBAN'].includes(action) && report.targetType !== 'USER') throw new CommunityModerationError('封禁操作仅适用于用户举报。');
    const status = action === 'REVIEWING' ? 'REVIEWING' : action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED';
    if (['OPEN', 'REVIEWING'].includes(report.status)) await tx.report.update({where: {id: report.id}, data: {status}});
    if (action === 'HIDE' || action === 'RESTORE') {
      const saved = await setContentVisibilityFromReport(tx, report.targetType === 'POST' ? 'POST' : 'COMMENT', report.targetId, action === 'RESTORE');
      if (!saved.count) throw new CommunityModerationError('举报目标已不存在，未执行处置。', 404);
    } else if (action === 'BAN' || action === 'UNBAN') {
      try {await setCommunityRestriction(tx, report.targetId, action === 'BAN', reason, action === 'UNBAN');}
      catch (error) {if (error instanceof Error && error.message === 'USER_NOT_BANNED') throw new CommunityModerationError('该账号当前未被封禁。', 409); if (error instanceof Error && error.message === 'USER_TARGET_MISSING') throw new CommunityModerationError('举报目标已不存在。', 404); throw error;}
    }
    await tx.moderationAction.create({data: {actorId, targetType: report.targetType, targetId: report.targetId, action, reason}});
    return {success: true, status};
  });
}
export async function reviewCommunityAppeal(actorId: string, appealId: string, input: unknown) {
  const body = inputObject(input), resolution = explanation(body.resolution);
  if (body.status !== 'ACCEPTED' && body.status !== 'REJECTED') throw new CommunityModerationError('请选择复核结果。');
  const status = body.status;
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimModerator(tx, actorId);
    const appeal = await tx.communityAppeal.findUnique({where: {id: appealId}, select: {userId: true, status: true}});
    if (!appeal) throw new CommunityModerationError('申诉记录不存在。', 404);
    if (appeal.status !== 'OPEN') throw new CommunityModerationError('该申诉已处理。', 409);
    await tx.communityAppeal.update({where: {id: appealId}, data: {status, resolution, reviewedBy: actorId, reviewedAt: new Date()}});
    if (status === 'ACCEPTED') {
      try {await setCommunityRestriction(tx, appeal.userId, false, resolution);}
      catch (error) {if (error instanceof Error && error.message === 'USER_TARGET_MISSING') throw new CommunityModerationError('申诉账号已注销。', 409); throw error;}
    }
    await tx.moderationAction.create({data: {actorId, targetType: 'APPEAL', targetId: appealId, action: `APPEAL_REVIEWED_${status}`, reason: resolution}});
    return {success: true, status};
  });
}
