import {db} from '@rumiai/backend/infrastructure/database/client';
import type {ChargeStatus} from '@rumiai/contracts/billing/types';

/** 一次请求的费用单摘要：断线查询与对账只读这几项，不暴露价格快照与调用 id。 */
export interface TurnChargeView {
  operation: string;
  status: ChargeStatus;
  coins: number;
  allowanceSource: string;
  messageId: string | null;
}

/**
 * 按请求号取费用单（V3 §20 断线查询）。
 *
 * 费用表的唯一键是 (userId, operation, requestId)，查询端不知道这次是 SEND 还是
 * REGENERATE，所以按用户 + 会话 + 请求号定位；带上会话是为了让「同一编号换个会话」
 * 查不到东西，而不是串到别的对话上。
 */
export async function readTurnCharge(input: {userId: string; conversationId: string | null; requestId: string}): Promise<TurnChargeView | null> {
  const row = await db.generationCharge.findFirst({
    where: {userId: input.userId, requestId: input.requestId, ...(input.conversationId ? {conversationId: input.conversationId} : {})},
    select: {operation: true, status: true, coins: true, allowanceSource: true, messageId: true},
  });
  if (!row) return null;
  return {operation: row.operation, status: row.status as ChargeStatus, coins: row.coins, allowanceSource: row.allowanceSource ?? 'PAID', messageId: row.messageId};
}
