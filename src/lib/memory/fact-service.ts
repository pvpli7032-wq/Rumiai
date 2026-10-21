import {db} from '@/lib/db';
import {MemoryError, type MemoryFactInput, type MemoryFactStatus, type MemoryFactView} from './types';

/**
 * 关键事实（V3 第 25 章）。
 *
 * 事实永远带来源消息：可编辑、可固定（优先注入）、可删除；来源消息被删除或编辑时
 * 由失效逻辑置 INVALID，不再注入，也不把猜测写成确定记忆。
 */

const MAX_FACT_CHARS = 200;
const MAX_FACTS_PER_CONVERSATION = 200;

function toView(row: {id: string; text: string; pinned: boolean; sourceMessageId: string | null; status: string; createdAt: Date}): MemoryFactView {
  return {
    id: row.id,
    text: row.text,
    pinned: row.pinned,
    sourceMessageId: row.sourceMessageId,
    status: (row.status as MemoryFactStatus) ?? 'ACTIVE',
    createdAt: row.createdAt.toISOString(),
  };
}

/** 会话必须属于本人：事实按用户与会话双重隔离，不同会话的私人经历不自动合并。 */
async function requireOwnedConversation(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
  if (!conversation) throw new MemoryError('会话不存在。', 404, 'MEMORY_CONVERSATION_NOT_FOUND');
  if (conversation.userId !== userId) throw new MemoryError('没有权限访问这条会话的记忆。', 403, 'MEMORY_FORBIDDEN');
}

export async function listMemoryFacts(userId: string, conversationId: string, options: {includeInactive?: boolean} = {}): Promise<MemoryFactView[]> {
  await requireOwnedConversation(userId, conversationId);
  const rows = await db.memoryFact.findMany({
    where: {conversationId, userId, ...(options.includeInactive ? {} : {status: 'ACTIVE'})},
    orderBy: [{pinned: 'desc'}, {createdAt: 'desc'}],
    select: {id: true, text: true, pinned: true, sourceMessageId: true, status: true, createdAt: true},
  });
  return rows.map(toView);
}

export async function createMemoryFact(userId: string, conversationId: string, input: MemoryFactInput): Promise<MemoryFactView> {
  await requireOwnedConversation(userId, conversationId);
  const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new MemoryError('事实内容不能为空。', 400, 'MEMORY_FACT_EMPTY');
  if (Array.from(text).length > MAX_FACT_CHARS) throw new MemoryError('事实内容最多 ' + MAX_FACT_CHARS + ' 字。', 400, 'MEMORY_FACT_TOO_LONG');
  const total = await db.memoryFact.count({where: {conversationId, status: {not: 'DELETED'}}});
  if (total >= MAX_FACTS_PER_CONVERSATION) throw new MemoryError('这条会话的事实条数已达上限。', 409, 'MEMORY_FACT_LIMIT');
  const sourceMessageId = typeof input.sourceMessageId === 'string' && input.sourceMessageId ? input.sourceMessageId : null;
  const row = await db.memoryFact.create({
    data: {conversationId, userId, text, sourceMessageId, pinned: input.pinned === true, status: 'ACTIVE'},
    select: {id: true, text: true, pinned: true, sourceMessageId: true, status: true, createdAt: true},
  });
  return toView(row);
}

/** 编辑 / 固定都只影响这一条事实；不重建摘要，也不触发模型调用。 */
export async function updateMemoryFact(userId: string, factId: string, input: MemoryFactInput): Promise<MemoryFactView> {
  const existing = await db.memoryFact.findUnique({where: {id: factId}, select: {userId: true, status: true}});
  if (!existing) throw new MemoryError('事实不存在。', 404, 'MEMORY_FACT_NOT_FOUND');
  if (existing.userId !== userId) throw new MemoryError('没有权限修改这条事实。', 403, 'MEMORY_FORBIDDEN');
  if (existing.status === 'DELETED') throw new MemoryError('这条事实已删除。', 409, 'MEMORY_FACT_DELETED');
  const data: {text?: string; pinned?: boolean; status?: string} = {};
  if (input.text !== undefined) {
    const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) throw new MemoryError('事实内容不能为空。', 400, 'MEMORY_FACT_EMPTY');
    if (Array.from(text).length > MAX_FACT_CHARS) throw new MemoryError('事实内容最多 ' + MAX_FACT_CHARS + ' 字。', 400, 'MEMORY_FACT_TOO_LONG');
    data.text = text;
    // 用户确认过内容，之前因来源消息失效的事实重新生效。
    if (existing.status === 'INVALID') data.status = 'ACTIVE';
  }
  if (typeof input.pinned === 'boolean') data.pinned = input.pinned;
  if (!Object.keys(data).length) throw new MemoryError('没有要修改的内容。', 400, 'MEMORY_FACT_EMPTY_PATCH');
  const row = await db.memoryFact.update({where: {id: factId}, data, select: {id: true, text: true, pinned: true, sourceMessageId: true, status: true, createdAt: true}});
  return toView(row);
}

/** 删除是软删除：保留行以便后台核对，但永不参与注入。 */
export async function deleteMemoryFact(userId: string, factId: string): Promise<{id: string; status: MemoryFactStatus}> {
  const existing = await db.memoryFact.findUnique({where: {id: factId}, select: {userId: true}});
  if (!existing) throw new MemoryError('事实不存在。', 404, 'MEMORY_FACT_NOT_FOUND');
  if (existing.userId !== userId) throw new MemoryError('没有权限删除这条事实。', 403, 'MEMORY_FORBIDDEN');
  const row = await db.memoryFact.update({where: {id: factId}, data: {status: 'DELETED', pinned: false}, select: {id: true, status: true}});
  return {id: row.id, status: row.status as MemoryFactStatus};
}

/** 来源消息被删除或编辑：对应事实立即失效，不再注入。 */
export async function invalidateFactsForMessage(conversationId: string, messageId: string): Promise<number> {
  const changed = await db.memoryFact.updateMany({
    where: {conversationId, sourceMessageId: messageId, status: 'ACTIVE'},
    data: {status: 'INVALID'},
  });
  return changed.count;
}

/** 注入用：固定事实优先，其次最新，最多 maxFacts 条。 */
export async function readInjectableFacts(conversationId: string, maxFacts: number): Promise<MemoryFactView[]> {
  if (maxFacts <= 0) return [];
  const rows = await db.memoryFact.findMany({
    where: {conversationId, status: 'ACTIVE'},
    orderBy: [{pinned: 'desc'}, {createdAt: 'desc'}],
    take: maxFacts,
    select: {id: true, text: true, pinned: true, sourceMessageId: true, status: true, createdAt: true},
  });
  return rows.map(toView);
}
