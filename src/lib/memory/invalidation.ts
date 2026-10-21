import type {Prisma} from '@prisma/client';
import {logWarning} from '@/lib/logger';

/**
 * 历史变更时的记忆失效（V3 §25 表 21：「删除或编辑旧消息时使相应摘要与事实失效，
 * 重新建立有效上下文」）。
 *
 * 这里的函数都吃事务客户端：消息变更和记忆失效必须同一个事务，事务外补的话，
 * 中间失败会留下「消息没了、事实还 ACTIVE 继续注入」的脏状态。
 */

/** 只用到这两张表，收窄类型让调用方可以直接传 $transaction 的 tx。 */
type MemoryTx = Pick<Prisma.TransactionClient, 'memoryFact' | 'conversationMemory'>;

/** 仍然活着的状态：只有这两种需要失效；INVALID/DELETED 已经是失效态。 */
const LIVE_FACT_STATUSES = ['ACTIVE', 'PENDING'] as const;

/** 这些消息派生的事实全部置 INVALID；返回失效条数。 */
export async function invalidateFactsOfMessages(tx: MemoryTx, conversationId: string, messageIds: string[]): Promise<number> {
  if (!messageIds.length) return 0;
  const changed = await tx.memoryFact.updateMany({
    where: {conversationId, sourceMessageId: {in: messageIds}, status: {in: [...LIVE_FACT_STATUSES]}},
    data: {status: 'INVALID'},
  });
  return changed.count;
}

/**
 * 摘要整行删除，下次摘要任务从剩余消息重建。
 *
 * 不在这里登记任务：登记由 enqueueSummaryIfDue 在下一轮回复后按阈值触发，
 * 避免历史变更顺手把任务队列也改了。
 */
export async function invalidateSummaryInTransaction(tx: MemoryTx, conversationId: string, reason: string): Promise<boolean> {
  const removed = await tx.conversationMemory.deleteMany({where: {conversationId}});
  if (removed.count) logWarning('memory_summary_invalidated', {conversationId, reason});
  return removed.count > 0;
}

/** 一次消息变更要做的全部记忆失效：事实 + 摘要，同一个事务。 */
export async function invalidateMemoryForMessages(
  tx: MemoryTx,
  conversationId: string,
  messageIds: string[],
  reason: string,
): Promise<{facts: number; summaryRemoved: boolean}> {
  const facts = await invalidateFactsOfMessages(tx, conversationId, messageIds);
  const summaryRemoved = await invalidateSummaryInTransaction(tx, conversationId, reason);
  return {facts, summaryRemoved};
}
