import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';

export class CharacterReviewError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
type Item = {id: string; updatedAt: Date};
function item(input: unknown): Item {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterReviewError('角色版本格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id) || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new CharacterReviewError('角色编号或版本无效。');
  return {id: body.id, updatedAt: new Date(body.updatedAt)};
}
async function applyReview(tx: Prisma.TransactionClient, actorId: string, target: Item, status: 'APPROVED' | 'REJECTED', reason: string) {
  const before = await tx.character.findUnique({where: {id: target.id}, select: {id: true, updatedAt: true, reviewStatus: true, isPublic: true, publicationRequested: true, copyrightStatement: true}});
  if (!before) throw new CharacterReviewError('角色不存在。', 404);
  if (before.updatedAt.getTime() !== target.updatedAt.getTime() || !before.publicationRequested || !['PENDING', 'APPROVED'].includes(before.reviewStatus)) throw new CharacterReviewError('角色已修改、撤回或不在审核队列，请刷新后重试。', 409);
  if (status === 'APPROVED' && !before.copyrightStatement?.trim()) throw new CharacterReviewError('缺少版权声明，请退回补充。');
  const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
  const saved = await tx.character.updateMany({where: {id: target.id, updatedAt: target.updatedAt, publicationRequested: true, reviewStatus: {in: ['PENDING', 'APPROVED']}}, data: {reviewStatus: status, isPublic: status === 'APPROVED', reviewReason: reason || null, reviewedBy: actorId, reviewedAt: new Date(), updatedAt}});
  if (!saved.count) throw new CharacterReviewError('角色已被修改，请刷新后重试。', 409);
  await recordAdminAudit(tx, actorId, `CHARACTER_${status}`, target.id, reason || '审核通过公开', {before: {status: before.reviewStatus, isPublic: before.isPublic, updatedAt: before.updatedAt}, after: {status, isPublic: status === 'APPROVED', updatedAt}});
  return {id: target.id, updatedAt, status};
}
export async function reviewCharacters(actorId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterReviewError('审核数据格式不正确。');
  const body = input as Record<string, unknown>;
  if (body.status !== 'APPROVED' && body.status !== 'REJECTED' || typeof body.reason !== 'string' || body.reason.length > 1000 || body.status === 'REJECTED' && !body.reason.trim() || !Array.isArray(body.items) || !body.items.length || body.items.length > 25) throw new CharacterReviewError('请选择审核结果并填写原因，单次最多25个角色；退回理由必填。');
  const status = body.status, reason = body.reason.trim(), items = body.items.map(item);
  if (new Set(items.map(target => target.id)).size !== items.length) throw new CharacterReviewError('角色列表不能重复。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actorId}`;
    if (!await hasAdminPermission(actorId, 'moderation.write', tx)) throw new CharacterReviewError('此操作仅限审核人员。', 403);
    const results = [];
    for (const target of items) results.push(await applyReview(tx, actorId, target, status, reason));
    return {success: true, items: results};
  });
}
export async function reviewCharacter(actorId: string, characterId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterReviewError('审核数据格式不正确。');
  const body = input as Record<string, unknown>;
  await reviewCharacters(actorId, {status: body.status, reason: body.reason, items: [{id: characterId, updatedAt: body.updatedAt}]});
  return {success: true};
}
