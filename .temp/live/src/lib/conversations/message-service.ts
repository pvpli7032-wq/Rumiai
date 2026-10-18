import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export async function readConversationMessages(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
  if (!conversation) throw new ConversationMessageError('Not found', 404);
  if (conversation.userId !== userId) throw new ConversationMessageError('Forbidden', 403);
  return db.message.findMany({
    where: {conversationId}, orderBy: {createdAt: 'asc'},
    select: {id: true, role: true, content: true, likedAt: true, imageUrl: true, createdAt: true},
  });
}

export async function createUserMessage(conversationId: string, content: string) {
  return db.message.create({data: {conversationId, role: 'USER', content}});
}

export async function readRecentMessageHistory(conversationId: string, excludedMessageId: string, limit: number) {
  const recent = await db.message.findMany({
    where: {conversationId, id: {not: excludedMessageId}},
    orderBy: {createdAt: 'desc'}, take: limit, select: {role: true, content: true},
  });
  return recent.reverse();
}

export async function persistAssistantResponse(conversationId: string, characterId: string, content: string) {
  const hasReply = Boolean(content.trim());
  return db.$transaction(async tx => {
    const assistantMessage = hasReply
      ? await tx.message.create({data: {conversationId, role: 'ASSISTANT', content}})
      : null;
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: new Date()}});
    await tx.character.update({where: {id: characterId}, data: {messageCount: {increment: hasReply ? 2 : 1}}});
    return assistantMessage;
  });
}

export async function prepareMessageRegeneration(userId: string, conversationId: string, targetMessageId: string, historyLimit: number) {
  const target = await requireOwnedMessage(db, conversationId, targetMessageId, userId);
  const prompt = target.role === 'USER'
    ? {id: target.id, content: target.content, createdAt: target.createdAt}
    : await db.message.findFirst({
        where: {conversationId, role: 'USER', createdAt: {lt: target.createdAt}},
        orderBy: {createdAt: 'desc'},
        select: {id: true, content: true, createdAt: true},
      });
  if (!prompt) throw new ConversationMessageError('Nothing to reply to', 400);
  const history = await db.message.findMany({
    where: {conversationId, createdAt: {lt: prompt.createdAt}},
    orderBy: {createdAt: 'desc'}, take: historyLimit, select: {role: true, content: true},
  });
  return {prompt, history: history.reverse()};
}

export async function replaceMessageReply(conversationId: string, promptCreatedAt: Date, content: string) {
  if (!content.trim()) return null;
  return db.$transaction(async tx => {
    await tx.message.deleteMany({where: {conversationId, createdAt: {gt: promptCreatedAt}}});
    const assistant = await tx.message.create({data: {conversationId, role: 'ASSISTANT', content}});
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: new Date()}});
    return assistant;
  });
}

const MAX_MESSAGE_CONTENT = 4_000;

export class ConversationMessageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ConversationMessageError';
  }
}

async function requireOwnedMessage(tx: Pick<Prisma.TransactionClient, 'message'>, conversationId: string, messageId: string, userId: string) {
  const message = await tx.message.findUnique({
    where: {id: messageId},
    select: {id: true, conversationId: true, role: true, content: true, likedAt: true, createdAt: true, conversation: {select: {userId: true}}},
  });
  if (!message || message.conversationId !== conversationId) throw new ConversationMessageError('Message not found', 404);
  if (message.conversation.userId !== userId) throw new ConversationMessageError('Forbidden', 403);
  return message;
}

export async function setMessageLiked(userId: string, conversationId: string, messageId: string, liked: boolean) {
  return db.$transaction(async tx => {
    const message = await requireOwnedMessage(tx, conversationId, messageId, userId);
    if (liked && message.likedAt) return {success: true, liked: true, likedAt: message.likedAt};
    const updated = await tx.message.update({
      where: {id: messageId},
      data: {likedAt: liked ? new Date() : null},
      select: {likedAt: true},
    });
    return {success: true, liked, ...(liked ? {likedAt: updated.likedAt} : {})};
  });
}

export async function editUserMessage(userId: string, conversationId: string, messageId: string, input: unknown) {
  return db.$transaction(async tx => {
    const message = await requireOwnedMessage(tx, conversationId, messageId, userId);
    if (message.role !== 'USER') throw new ConversationMessageError('Only your own message can be edited', 400);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConversationMessageError('Message data is invalid', 400);
    const rawContent = (input as Record<string, unknown>).content;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';
    if (!content) throw new ConversationMessageError('content is required', 400);
    if (content.length > MAX_MESSAGE_CONTENT) throw new ConversationMessageError(`content must be ${MAX_MESSAGE_CONTENT} characters or fewer`, 400);

    const updated = await tx.message.update({
      where: {id: messageId},
      data: {content},
      select: {id: true, role: true, content: true, likedAt: true, createdAt: true},
    });
    const dropped = await tx.message.deleteMany({where: {conversationId, createdAt: {gt: message.createdAt}}});
    return {message: updated, droppedReplies: dropped.count};
  });
}

export async function deleteMessageAndFollowing(userId: string, conversationId: string, messageId: string) {
  return db.$transaction(async tx => {
    const message = await requireOwnedMessage(tx, conversationId, messageId, userId);
    const removed = await tx.message.deleteMany({where: {conversationId, createdAt: {gte: message.createdAt}}});
    return {success: true, removed: removed.count};
  });
}
