import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, pragmasReady } from '@/lib/db';
import { eraseAccountConversations } from '@/lib/conversations/privacy';
import { withdrawAccountCharacters } from '@/lib/characters/privacy';
import { eraseAccountCommunityContent } from '@/lib/community/privacy';
import { finishClosureFileCleanup } from '@/lib/uploads/privacy';
import { listOwnedUploadFiles } from '@/lib/uploads/storage-service';
import {closeAdminIdentity, AdminManagementError} from '@/lib/admin/management-service';

export class AccountClosureError extends Error {
  constructor(message: string, public status = 400) { super(message); }
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
    const ownedFiles = await tx.uploadAsset.findMany({ where: { ownerId: userId }, select: { url: true } });
    const urls = [current.avatarUrl, ...ownedFiles.map(row => row.url), ...await listOwnedUploadFiles(userId),
      ...await eraseAccountConversations(tx, userId),
      ...await withdrawAccountCharacters(tx, userId),
      ...await eraseAccountCommunityContent(tx, userId)];
    // Accounting/usage and report evidence stay linked to an anonymous identity.
    await tx.report.updateMany({ where: { reporterId: userId }, data: { contactType: null, contactValue: null } });
    await tx.user.update({ where: { id: userId }, data: {
      username: retiredHandle, email: `${retiredHandle}@account.invalid`, passwordHash: unusableHash,
      displayName: '已注销用户', avatarUrl: null, bannedWords: null, shortcuts: null, readingMode: false,
      followerCount: 0, characterCount: 0, messageCount: 0, chatCount: 0, universeMessageCount: 0, universeChatCount: 0, weeklyFollowerGain: 0,
      deletedAt: new Date(),
    } });
    return tx.accountClosure.create({ data: { userId, fileUrlsJson: JSON.stringify([...new Set(urls.filter((value): value is string => typeof value === 'string' && /^\/uploads\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value)))]) } });
  }, { timeout: 15000 });
  const status = await finishClosureFileCleanup(closure.id);
  return { closed: true, reference: closure.id, fileCleanupPending: status !== 'COMPLETED' };
}
