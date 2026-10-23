import {db} from '@rumiai/backend/infrastructure/database/client';
import {readTurnCharge} from '@rumiai/backend/modules/billing/turn-lookup';

/** 断线后按请求号查回执的返回体；status 是前台要的分支，chargeStatus 是费用单原始状态。 */
export interface TurnQueryResult {
  requestId: string;
  chargeStatus: string | null;
  coins: number;
  allowanceSource: string;
  messageId: string | null;
  status: 'DONE' | 'PENDING' | 'FAILED' | 'NONE';
}

/**
 * 按请求号查一次聊天请求的结果（V3 §20）：先确认对话属于本人，再读费用单与已保存的回复。
 * 对话不属于本人时返回 null（路由按 404 处理，不暴露别人的对话是否存在）。
 */
export async function readTurnState(userId: string, conversationId: string, requestId: string): Promise<TurnQueryResult | null> {
  const owned = await db.conversation.findFirst({where: {id: conversationId, userId}, select: {id: true}});
  if (!owned) return null;
  const charge = await readTurnCharge({userId, conversationId, requestId});
  // 关闭收费或还没走到预扣：没有费用单，也就没有可确认的回复。
  if (!charge) return {requestId, chargeStatus: null, coins: 0, allowanceSource: 'PAID', messageId: null, status: 'NONE'};
  const status: TurnQueryResult['status'] = charge.messageId ? 'DONE' : charge.status === 'HELD' ? 'PENDING' : charge.status === 'SETTLED' ? 'DONE' : 'FAILED';
  return {requestId, chargeStatus: charge.status, coins: charge.coins, allowanceSource: charge.allowanceSource, messageId: charge.messageId, status};
}
