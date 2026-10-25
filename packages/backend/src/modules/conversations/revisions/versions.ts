import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {invalidateMemoryForMessages} from '@rumiai/backend/modules/memory/invalidation';
import {ChatContextError, ownedMessage} from '../context/access';

export async function ensureOriginalVersion(tx: Prisma.TransactionClient, message: {id: string; content: string; selectedVersionId: string | null}) {
  if (message.selectedVersionId) return message.selectedVersionId;
  const version = await tx.messageVersion.create({data: {messageId: message.id, content: message.content, source: 'ORIGINAL'}});
  await tx.message.update({where: {id: message.id}, data: {selectedVersionId: version.id}});
  return version.id;
}
export async function listMessageVersions(userId: string, conversationId: string, messageId: string) {
  const {message} = await ownedMessage(userId, conversationId, messageId);
  const items = await db.messageVersion.findMany({where: {messageId}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
  return {selectedVersionId: message.selectedVersionId, items: items.length ? items : [{id: 'current', messageId, content: message.content, source: 'ORIGINAL', createdAt: message.createdAt}]};
}
export async function chooseMessageVersion(userId: string, conversationId: string, messageId: string, versionId: unknown) {
  const {message} = await ownedMessage(userId, conversationId, messageId);
  if (message.role !== 'ASSISTANT') throw new ChatContextError('只有角色回复支持版本切换。');
  return db.$transaction(async tx => {
    const version = typeof versionId === 'string' ? await tx.messageVersion.findFirst({where: {id: versionId, messageId}}) : null;
    if (!version) throw new ChatContextError('回复版本不存在。', 404);
    if (version.id === message.selectedVersionId) return {success: true, dropped: 0};
    const affected = await tx.message.findMany({where: {conversationId, OR: [{id: messageId}, {createdAt: {gt: message.createdAt}}, {createdAt: message.createdAt, id: {gt: message.id}}]}, select: {id: true}});
    await invalidateMemoryForMessages(tx, conversationId, affected.map(row => row.id), 'MESSAGE_VERSION_CHANGED');
    await tx.message.update({where: {id: messageId}, data: {content: version.content, selectedVersionId: version.id}});
    const dropped = await tx.message.deleteMany({where: {conversationId, OR: [{createdAt: {gt: message.createdAt}}, {createdAt: message.createdAt, id: {gt: message.id}}]}});
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: new Date()}});
    return {success: true, dropped: dropped.count};
  });
}
export async function setMessageContextIncluded(userId: string, conversationId: string, messageId: string, included: unknown) {
  await ownedMessage(userId, conversationId, messageId);
  if (typeof included !== 'boolean') throw new ChatContextError('上下文状态须为布尔值。');
  return db.$transaction(async tx => {
    await tx.message.update({where: {id: messageId}, data: {contextIncluded: included}});
    await invalidateMemoryForMessages(tx, conversationId, [messageId], included ? 'MESSAGE_REINCLUDED' : 'MESSAGE_EXCLUDED');
    return {success: true, contextIncluded: included};
  });
}
export async function recordMessageFeedback(userId: string, conversationId: string, messageId: string, reason: unknown) {
  const {message} = await ownedMessage(userId, conversationId, messageId);
  if (message.role !== 'ASSISTANT' || reason !== 'REPETITIVE') throw new ChatContextError('请选择有效的回复反馈。');
  await db.messageFeedback.upsert({where: {userId_messageId_reason: {userId, messageId, reason}}, create: {userId, messageId, reason}, update: {}});
  return {success: true, message: '已记录重复回复反馈。可按当前费用重新生成，不会自动重试或额外扣费。'};
}
