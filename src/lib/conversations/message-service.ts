import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/**
 * Dependency inversion for story history（V3 第 16 章）：the single
 * direction rule forbids conversations → stories imports, so the story side
 * registers its invalidation handler here at module load (see
 * src/lib/stories/lifecycle/invalidation.ts). Ordinary conversations never call
 * it. Fail closed: a story conversation without a registered handler refuses
 * the change instead of silently skipping derived-state invalidation.
 */
type StoryHistoryInvalidator = (tx: Prisma.TransactionClient, runId: string, messageId: string) => Promise<void>;
let storyHistoryInvalidator: StoryHistoryInvalidator | null = null;

export function registerStoryHistoryInvalidator(impl: StoryHistoryInvalidator | null) {
  storyHistoryInvalidator = impl;
}

async function invalidateStoryHistory(tx: Prisma.TransactionClient, runId: string | null, messageId: string) {
  if (!runId) return;
  if (!storyHistoryInvalidator) throw new ConversationMessageError('故事历史修改暂不可用，请稍后重试。', 503);
  await storyHistoryInvalidator(tx, runId, messageId);
}

export async function readConversationMessages(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
  if (!conversation) throw new ConversationMessageError('Not found', 404);
  if (conversation.userId !== userId) throw new ConversationMessageError('Forbidden', 403);
  // id is the tiebreaker: two rows written in the same millisecond (a turn's user message
  // and its reply can commit together) would otherwise come back in an arbitrary order,
  // and "delete this and everything after it" would then delete the wrong rows.
  return db.message.findMany({
    where: {conversationId}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    select: {id: true, role: true, content: true, likedAt: true, imageUrl: true, createdAt: true},
  });
}

/** 历史分页的稳定游标：createdAt 是主序，id 破同毫秒并列。 */
type MessageCursor = {createdAt: string; id: string};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function decodeCursor(value?: string | null): MessageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<MessageCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !parsed.id) throw Error();
    if (Number.isNaN(Date.parse(parsed.createdAt))) throw Error();
    return {createdAt: parsed.createdAt, id: parsed.id};
  } catch { throw new ConversationMessageError('历史游标格式不正确。', 422); }
}

function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function pageSizeOf(value?: string | null): number {
  if (value == null || value === '') return DEFAULT_PAGE_SIZE;
  if (!/^\d+$/.test(value)) throw new ConversationMessageError('每页数量须为 1–200。', 422);
  const size = Number(value);
  if (size < 1 || size > MAX_PAGE_SIZE) throw new ConversationMessageError('每页数量须为 1–200。', 422);
  return size;
}

/**
 * 按页读取会话历史，从最新一页往前翻。
 *
 * 规划书 §21 要求：新增 before 游标、limit 与 nextCursor，并保留旧调用方的原响应。
 * 因此本函数只服务显式选择分页模式的调用方；`readConversationMessages` 保持整段返回。
 * 顺序与整段读取一致（createdAt 升序、id 破并列），游标指向本页最早一条，
 * 下一页取"严格早于它"的消息，所以翻页不会重复也不会漏。
 */
export async function readConversationMessagePage(
  userId: string,
  conversationId: string,
  options: {limit?: string | null; before?: string | null} = {},
) {
  const conversation = await db.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
  if (!conversation) throw new ConversationMessageError('Not found', 404);
  if (conversation.userId !== userId) throw new ConversationMessageError('Forbidden', 403);
  const take = pageSizeOf(options.limit);
  const before = decodeCursor(options.before);
  const rows = await db.message.findMany({
    where: {
      conversationId,
      ...(before ? {OR: [{createdAt: {lt: new Date(before.createdAt)}}, {createdAt: new Date(before.createdAt), id: {lt: before.id}}]} : {}),
    },
    // 多取一条只用来判断还有没有更早的，不返回给调用方。
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: take + 1,
    select: {id: true, role: true, content: true, likedAt: true, imageUrl: true, createdAt: true},
  });
  const hasMore = rows.length > take;
  const page = (hasMore ? rows.slice(0, take) : rows).reverse();
  const oldest = page[0];
  return {
    messages: page,
    hasMore,
    nextCursor: hasMore && oldest ? encodeCursor({createdAt: oldest.createdAt.toISOString(), id: oldest.id}) : null,
  };
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
    select: {id: true, conversationId: true, role: true, content: true, likedAt: true, createdAt: true, conversation: {select: {userId: true, storyRun: {select: {id: true}}}}},
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

    // Story history: the message change and the invalidation of every derived
    // event/checkpoint from this turn share ONE transaction (contract §7); the
    // story side supplies the invalidation rules through the registered handler.
    const storyRunId = message.conversation.storyRun?.id ?? null;

    const updated = await tx.message.update({
      where: {id: messageId},
      data: {content},
      select: {id: true, role: true, content: true, likedAt: true, createdAt: true},
    });
    const dropped = await tx.message.deleteMany({where: {conversationId, createdAt: {gt: message.createdAt}}});
    await invalidateStoryHistory(tx, storyRunId, messageId);
    return {message: updated, droppedReplies: dropped.count};
  });
}

export async function deleteMessageAndFollowing(userId: string, conversationId: string, messageId: string) {
  return db.$transaction(async tx => {
    const message = await requireOwnedMessage(tx, conversationId, messageId, userId);
    // Story history: same-transaction invalidation from the owning turn (contract §7).
    // Must resolve BEFORE the message is deleted — StoryTurn's message references are
    // onDelete: SetNull, so a lookup after the delete would find nothing.
    const storyRunId = message.conversation.storyRun?.id ?? null;
    await invalidateStoryHistory(tx, storyRunId, messageId);
    // Same total order as readConversationMessages: (createdAt, id). A plain
    // `createdAt >= target.createdAt` also deletes earlier rows that share the target's
    // millisecond, which is reachable whenever a turn's messages are written together.
    const removed = await tx.message.deleteMany({where: {conversationId, OR: [
      {createdAt: {gt: message.createdAt}},
      {createdAt: message.createdAt, id: {gte: message.id}},
    ]}});
    return {success: true, removed: removed.count};
  });
}
