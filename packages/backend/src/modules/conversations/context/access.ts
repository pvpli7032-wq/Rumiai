import {db} from '@rumiai/backend/infrastructure/database/client';
export class ChatContextError extends Error {
  constructor(message: string, readonly status = 400) {super(message);}
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatContextError('数据格式不正确。');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max: number, required = true): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw new ChatContextError(label + '不能为空。');
  if (result.length > max) throw new ChatContextError(label + '最多' + max + '字。');
  return result;
}
export async function ownedConversation(userId: string, id: string, ordinary = true) {
  const row = await db.conversation.findUnique({where: {id}, include: {storyRun: {select: {id: true}}, character: true}});
  if (!row || row.userId !== userId) throw new ChatContextError('会话不存在或无权访问。', 404);
  if (ordinary && row.storyRun) throw new ChatContextError('故事请使用故事管理功能。', 409);
  return row;
}
export async function ownedMessage(userId: string, conversationId: string, messageId: string) {
  const conversation = await ownedConversation(userId, conversationId);
  const message = await db.message.findUnique({where: {id: messageId}});
  if (!message || message.conversationId !== conversationId) throw new ChatContextError('消息不存在。', 404);
  return {conversation, message};
}
