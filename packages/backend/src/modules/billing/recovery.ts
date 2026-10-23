import {db} from '@rumiai/backend/infrastructure/database/client';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';
import {markChargeUnknown, releaseCharge, settleCharge} from '@rumiai/backend/modules/billing/charge-service';
import type {ChargeOperation} from '@rumiai/contracts/billing/types';

/**
 * HELD 超时核对（V3 §21「超时检查」）。
 *
 * 冻结超过 billing.holdTimeoutMinutes 后先读权威状态，再决定去留：
 * - 生成已完成且消息已保存 → 结算（不再扣余额）。
 * - 确认失败、未启动，或首个内容片段送达前取消 → 释放。
 * - 还在生成 → 保持待核对，什么都不做。
 * - 结果不明且已超过 2 天 → 转 UNKNOWN（不再重扫，后台按待核对金额挂账，等人处理）。
 *
 * 这里只读库内已有记录，绝不重发模型请求；费用单固化的价格快照与免费记录也不变。
 * 正常业务里消息保存与费用结算在同一事务完成，核对主要面对历史进程崩溃留下的 HELD 单。
 */

export type RecoveryDecision = 'SETTLED' | 'RELEASED' | 'KEPT' | 'UNKNOWN';

export interface RecoveryOutcome {
  chargeId: string;
  requestId: string;
  operation: ChargeOperation;
  decision: RecoveryDecision;
  reason: string;
  balanceDelta: number;
}

export interface RecoveryResult {
  scanned: number;
  settled: number;
  released: number;
  kept: number;
  unknown: number;
  outcomes: RecoveryOutcome[];
}

interface Candidate {
  id: string;
  userId: string;
  requestId: string;
  operation: string;
  aiCallId: string | null;
  conversationId: string | null;
  heldAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 判断一条 HELD 单据的权威结果。只读，不发模型请求、不改任何行。 */
async function inspect(charge: Candidate, now: Date): Promise<{decision: RecoveryDecision; reason: string; messageId?: string | null}> {
  const storyTurn = charge.operation === 'STORY_TURN' && charge.conversationId
    ? await db.storyTurn.findFirst({
        where: {requestId: charge.requestId, run: {conversationId: charge.conversationId}},
        select: {status: true, assistantMessageId: true},
      })
    : null;
  if (storyTurn) {
    if (storyTurn.status === 'COMMITTED') return {decision: 'SETTLED', reason: 'STORY_TURN_COMMITTED', messageId: storyTurn.assistantMessageId};
    if (storyTurn.status === 'FAILED' || storyTurn.status === 'CANCELLED') return {decision: 'RELEASED', reason: 'STORY_TURN_' + storyTurn.status};
    // ACCEPTED / GENERATING：还在生成，保持待核对；UNKNOWN：结果不明，等下一轮。
    return {decision: 'KEPT', reason: 'STORY_TURN_' + storyTurn.status};
  }

  const call = charge.aiCallId ? await db.aiCall.findUnique({where: {id: charge.aiCallId}, select: {status: true}}) : null;
  if (call) {
    if (call.status === 'FAILED') return {decision: 'RELEASED', reason: 'AI_CALL_FAILED'};
    if (call.status === 'CANCELLED') return {decision: 'RELEASED', reason: 'AI_CALL_CANCELLED'};
    // 调用成功但没有对应的已保存消息：结果不明，不盲目退款也不重发。
    return {decision: 'KEPT', reason: 'AI_CALL_' + call.status};
  }
  // 连调用记录都没落下（进程在建费用单与预留调用之间中断）：过了宽限期才按「未启动」释放。
  if (charge.heldAt.getTime() + 2 * DAY_MS < now.getTime()) return {decision: 'RELEASED', reason: 'CALL_NEVER_STARTED'};
  return {decision: 'KEPT', reason: 'CALL_PENDING'};
}

/**
 * 扫描超时的 HELD 费用单并核对一次。逐条顺序处理：SQLite 只有一个写者，
 * 也对齐「结算/释放各自幂等」的既有语义。
 */
export async function reconcileHeldCharges(options: {now?: Date; limit?: number; holdTimeoutMinutes?: number} = {}): Promise<RecoveryResult> {
  const now = options.now ?? new Date();
  const configured = options.holdTimeoutMinutes ?? (await readSettingValue<number>('billing.holdTimeoutMinutes'));
  const timeoutMinutes = Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : 10;
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60_000);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const rows = await db.generationCharge.findMany({
    where: {status: 'HELD', heldAt: {lt: cutoff}},
    orderBy: [{heldAt: 'asc'}, {id: 'asc'}],
    take: limit,
    select: {id: true, userId: true, requestId: true, operation: true, aiCallId: true, conversationId: true, heldAt: true},
  });

  const result: RecoveryResult = {scanned: rows.length, settled: 0, released: 0, kept: 0, unknown: 0, outcomes: []};
  for (const charge of rows) {
    const operation = charge.operation as ChargeOperation;
    let outcome: RecoveryOutcome;
    try {
      const verdict = await inspect(charge, now);
      if (verdict.decision === 'SETTLED') {
        const settled = await settleCharge({userId: charge.userId, requestId: charge.requestId, operation, messageId: verdict.messageId ?? null, now});
        outcome = {chargeId: charge.id, requestId: charge.requestId, operation, decision: settled.status === 'SETTLED' ? 'SETTLED' : 'KEPT', reason: verdict.reason, balanceDelta: 0};
      } else if (verdict.decision === 'RELEASED') {
        const released = await releaseCharge({userId: charge.userId, requestId: charge.requestId, operation, reason: verdict.reason, now});
        outcome = {chargeId: charge.id, requestId: charge.requestId, operation, decision: released.status === 'RELEASED' ? 'RELEASED' : 'KEPT', reason: verdict.reason, balanceDelta: released.balanceDelta};
      } else if (charge.heldAt.getTime() + 2 * DAY_MS < now.getTime()) {
        // 两天还没等到权威结果：转 UNKNOWN 挂账，不再每轮重扫；不退款也不重发。
        await markChargeUnknown({userId: charge.userId, requestId: charge.requestId, operation, now});
        outcome = {chargeId: charge.id, requestId: charge.requestId, operation, decision: 'UNKNOWN', reason: verdict.reason, balanceDelta: 0};
      } else {
        outcome = {chargeId: charge.id, requestId: charge.requestId, operation, decision: 'KEPT', reason: verdict.reason, balanceDelta: 0};
      }
    } catch {
      // 单条核对失败不影响其它单据；下一轮任务再处理，日志只带标识与代码。
      logWarning('charge_recovery_failed', {chargeId: charge.id, operation});
      outcome = {chargeId: charge.id, requestId: charge.requestId, operation, decision: 'KEPT', reason: 'RECOVERY_ERROR', balanceDelta: 0};
    }
    if (outcome.decision === 'SETTLED') result.settled += 1;
    else if (outcome.decision === 'RELEASED') result.released += 1;
    else if (outcome.decision === 'UNKNOWN') result.unknown += 1;
    else result.kept += 1;
    result.outcomes.push(outcome);
  }
  return result;
}

export interface PendingChargeSummary {
  /** 仍在冻结中的费用单数。 */
  held: number;
  /** 结果不明、等待核对的费用单数。 */
  unknown: number;
  /** 冻结/待核对金额合计（币）。 */
  pendingCoins: number;
  /** 其中占用免费额度的单据数。 */
  freeQuotaHeld: number;
}

/** 后台「价格与成本 · 待核对费用单」（V3 表 22 财务观察）。 */
export async function readPendingChargeSummary(): Promise<PendingChargeSummary> {
  const rows = await db.generationCharge.findMany({
    where: {status: {in: ['HELD', 'UNKNOWN']}},
    select: {status: true, coins: true, allowanceSource: true},
  });
  return {
    held: rows.filter(row => row.status === 'HELD').length,
    unknown: rows.filter(row => row.status === 'UNKNOWN').length,
    pendingCoins: rows.reduce((sum, row) => sum + row.coins, 0),
    freeQuotaHeld: rows.filter(row => row.allowanceSource === 'FREE_QUOTA').length,
  };
}
