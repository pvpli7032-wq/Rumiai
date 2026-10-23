import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, pragmasReady } from '@rumiai/backend/infrastructure/database/client';
import { eraseAccountConversations } from '@rumiai/backend/modules/conversations/privacy';
import { withdrawAccountCharacters } from '@rumiai/backend/modules/characters/privacy';
import { eraseAccountCommunityContent } from '@rumiai/backend/modules/community/privacy';
import { finishClosureFileCleanup } from '@rumiai/backend/modules/uploads/privacy';
import { listOwnedUploadFiles } from '@rumiai/backend/modules/uploads/storage-service';
import {closeAdminIdentity, AdminManagementError} from '@rumiai/backend/modules/admin/management-service';
import {markCaseHidden} from '@rumiai/backend/modules/disputes/visibility-service';
import type {Prisma} from '@prisma/client';

export class AccountClosureError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/**
 * 注销时清理 Mirror、评理与记忆（V3 §79「新增对象纳入账号删除」）。
 *
 * 注销是匿名化而不是删 user 行，所以 schema 上挂 onDelete: Cascade 的 MirrorResult /
 * DisputeCase / DisputeVote / MemoryFact 一条都不会被级联触发，必须显式处理：
 *
 * - MirrorResult：作者注销后结果不该继续公开，按 deleteMirrorResult 的语义把 READY 置 HIDDEN
 *   （删除一律写在 status 上，不物理删，账与费用单还挂着 shareId）。
 * - DisputeCase：已公开的案例是社区内容，删掉会让投票与评论悬空。帖子一律置 HIDDEN，
 *   读侧「帖子非 VISIBLE 且不是作者」直接 404，所以公开访问在结案前后都停得住。
 *   还没结案的再置 WITHDRAWN：结案入口只认 OPEN，否则会给一个已注销的作者写兜底判词。
 *   已结案的保留 CLOSED——后台隐藏也拒绝 CLOSED，结案结果不该因为作者注销而被抹掉。
 * - DisputeVote：投票行与 userId 都不动。票数是社区计数，删行会让票数对不上；
 *   而 user 行已被匿名化，这条关联不再指向任何可识别的人。
 * - ConversationMemory 随会话级联删除（eraseAccountConversations 删会话即带走）；
 *   MemoryFact 没有 conversation 外键，级联捞不到，必须单独删。
 */
async function eraseAccountNewObjects(tx: Prisma.TransactionClient, userId: string) {
  const cases = await tx.disputeCase.findMany({where: {authorId: userId}, select: {id: true, postId: true, closeStatus: true}});
  for (const row of cases) {
    if (row.closeStatus === 'CLOSED') await tx.post.updateMany({where: {id: row.postId}, data: {status: 'HIDDEN'}});
    else await markCaseHidden(tx, {caseId: row.id, postId: row.postId});
  }
  await tx.mirrorResult.updateMany({where: {userId, status: 'READY'}, data: {status: 'HIDDEN'}});
  await tx.memoryFact.deleteMany({where: {userId}});
}

export async function closeAccount(userId: string, input: unknown) {
  if (!input || typeof input !== 'object') throw new AccountClosureError('注销数据格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.password !== 'string' || body.password.length > 200 || body.confirmation !== '注销我的账号' || body.acknowledgeRetention !== true) throw new AccountClosureError('请填写密码，并确认注销及记录保留说明。');
  await pragmasReady;
  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw new AccountClosureError('账号不存在或已注销。', 401);
  if (!await bcrypt.compare(body.password, user.passwordHash)) throw new AccountClosureError('密码不正确。', 403);
  const retiredHandle = `closed_${randomUUID().replaceAll('-', '')}`;
  const unusableHash = await bcrypt.hash(randomUUID(), 10);
  const closure = await db.$transaction(async tx => {
    // Claim the writer before reads; concurrent closure or late writes cannot race erasure.
    const claimed = await tx.user.updateMany({ where: { id: userId, deletedAt: null, tokenVersion: user.tokenVersion }, data: { tokenVersion: { increment: 1 } } });
    if (!claimed.count) throw new AccountClosureError('账号状态已变化，请重新登录。', 409);
    try {await closeAdminIdentity(tx, userId);} catch (error) {
      if (error instanceof AdminManagementError) throw new AccountClosureError(error.message, error.status);
      throw error;
    }
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const pending = await tx.paymentOrder.count({ where: { userId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'REFUND_PENDING'] } } });
    if (pending) throw new AccountClosureError('有待核对的支付或退款，请先处理完再注销。', 409);
    if (await tx.aiCall.count({ where: { userId, status: 'STARTED' } })) throw new AccountClosureError('有尚未结束的 AI 请求，请等待完成后再注销。', 409);
    const ownedFiles = await tx.uploadAsset.findMany({ where: { ownerId: userId, siteOwned: false }, select: { url: true } });
    const urls = [current.avatarUrl, ...ownedFiles.map(row => row.url), ...await listOwnedUploadFiles(userId),
      ...await eraseAccountConversations(tx, userId),
      ...await withdrawAccountCharacters(tx, userId),
      ...await eraseAccountCommunityContent(tx, userId)];
    // Mirror / 评理 / 记忆：注销是匿名化，级联不触发，这里显式停公开访问并删私人记忆。
    await eraseAccountNewObjects(tx, userId);
    // Accounting/usage and report evidence stay linked to an anonymous identity.
    await tx.report.updateMany({ where: { reporterId: userId }, data: { contactType: null, contactValue: null } });
    await tx.user.update({ where: { id: userId }, data: {
      username: retiredHandle, email: `${retiredHandle}@account.invalid`, passwordHash: unusableHash,
      displayName: '已注销用户', avatarUrl: null, bannedWords: null, shortcuts: null, readingMode: false,
      followerCount: 0, characterCount: 0, messageCount: 0, chatCount: 0, universeMessageCount: 0, universeChatCount: 0, weeklyFollowerGain: 0,
      deletedAt: new Date(),
      suspendedAt: null, suspensionReason: null, lastLoginAt: null, lastActiveAt: null, accountVersion: {increment: 1},
    } });
    return tx.accountClosure.create({ data: { userId, fileUrlsJson: JSON.stringify([...new Set(urls.filter((value): value is string => typeof value === 'string' && /^\/uploads\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value)))]) } });
  }, { timeout: 15000 });
  const status = await finishClosureFileCleanup(closure.id);
  return { closed: true, reference: closure.id, fileCleanupPending: status !== 'COMPLETED' };
}
