import {db} from '@/lib/db';
import {readSettingValue} from '@/lib/settings/service';
import {lockAllowanceDay, readBillingTimezone, readFreeCancelLimit, resolveBillingDay} from './allowance';
import {findChargeInTx, releaseInTx, settleInTx, type Tx} from './charge-service';
import {CANCEL_POLICIES, type CancelPolicy, type ChargeOperation, type ChargeOutcome} from './types';

/**
 * 用户取消的计费判定（V3 表 8 billing.cancelPolicy / 表 16「用户取消」）。
 *
 * 顺序固定，聊天与故事共用这一份实现：
 * 1. 首个内容片段未送达 → 释放，不消耗免费取消次数。
 * 2. 已送达 + RELEASE_ALWAYS → 释放，不消耗。
 * 3. 已送达 + CHARGE_WHEN_OUTPUT → 当日还有免费取消次数就释放并占用一次，否则按已输出结算。
 *
 * 非用户原因（供应商失败、空回复、持久化失败、进程中断核对）不走这里：那些路径一律释放，
 * 也不消耗次数，所以免费取消额度不会被故障吃掉。
 */

export async function readCancelPolicy(userId: string): Promise<CancelPolicy> {
  const value = await readSettingValue<string>('billing.cancelPolicy', userId);
  return (CANCEL_POLICIES as readonly string[]).includes(value) ? value as CancelPolicy : 'CHARGE_WHEN_OUTPUT';
}

export interface CancelInput {
  userId: string;
  requestId: string;
  operation: ChargeOperation;
  /** 首个内容片段是否已送达用户。 */
  outputDelivered: boolean;
  messageId?: string | null;
  aiCallId?: string | null;
  now?: Date;
}

/**
 * 占用一次免费取消：条件更新，不读-改-写。
 * 并发时 `free_cancel_used = 已读值` 不成立、影响行数为 0，重读一次再试；次数不会超发。
 */
async function claimFreeCancel(tx: Tx, userId: string, day: string, limit: number): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await tx.userDailyAllowance.findUnique({where: {userId_day: {userId, day}}, select: {freeCancelUsed: true}});
    if (!row) {
      // 当天还没有额度行：先建空行，再走同一条条件更新。
      await tx.$executeRaw`INSERT INTO user_daily_allowances (user_id, day) VALUES (${userId}, ${day}) ON CONFLICT(user_id, day) DO NOTHING`;
      continue;
    }
    if (row.freeCancelUsed >= limit) return false;
    const claimed = await tx.$executeRaw`UPDATE user_daily_allowances SET free_cancel_used = free_cancel_used + 1
      WHERE user_id = ${userId} AND day = ${day} AND free_cancel_used = ${row.freeCancelUsed}`;
    if (claimed > 0) return true;
  }
  return false;
}

/** 用户取消：判定与落账在同一个事务里完成，重复调用只生效一次。 */
export async function settleCancellation(input: CancelInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  const [policy, freeCancelLimit, timezone] = await Promise.all([readCancelPolicy(input.userId), readFreeCancelLimit(input.userId), readBillingTimezone(input.userId)]);
  const day = resolveBillingDay(now, timezone);
  const base = {userId: input.userId, requestId: input.requestId, operation: input.operation, messageId: input.messageId ?? null, aiCallId: input.aiCallId ?? null};
  return db.$transaction(async tx => {
    // 先取写锁：判定与落账必须落在同一段串行区间，否则并发取消会各自读到 HELD 各占一次。
    await lockAllowanceDay(tx, input.userId);
    const existing = await findChargeInTx(tx, input.userId, input.operation, input.requestId);
    // 关闭收费没有费用单，或已经结算/释放：幂等回放，绝不占用次数。
    if (!existing || existing.status !== 'HELD') return releaseInTx(tx, existing, base, now);
    const releaseNow = !input.outputDelivered
      || policy === 'RELEASE_ALWAYS'
      || (freeCancelLimit > 0 && await claimFreeCancel(tx, input.userId, day, freeCancelLimit));
    return releaseNow ? releaseInTx(tx, existing, {...base, reason: 'USER_CANCELLED'}, now) : settleInTx(tx, existing, base, now);
  }, {timeout: 30_000});
}
