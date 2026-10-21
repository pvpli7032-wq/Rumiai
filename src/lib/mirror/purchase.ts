import {db} from '@/lib/db';
import {resolveBillingDay} from '@/lib/billing/allowance';
import {beginBillingTurn, toChargeError, type BillingTurn} from '@/lib/billing/turn';
import {MirrorError} from './errors';
import type {MirrorConfig} from './config';
import type {MirrorPurchase} from './types';

/**
 * 购买次数（V3 §23 的 CHARGE 分支）。
 *
 * 扣费不在这里实现：一次超额生成 = 一张 operation=MIRROR 的费用单，走 billing 的
 * quote → hold → settle/release（唯一入口），所以余额条件扣减、幂等、失败返还、
 * 超时核对全部沿用聊天那一套。本文件只负责三件事：
 * 1) 按设置算出「有没有购买这个选项、一次多少币」；
 * 2) 从费用单反查今天已经买过几次（进程重启后仍然准确）；
 * 3) 把 billing 的失败翻成 Mirror 自己的错误文案。
 */

/** 今天已购买次数：按业务日筛费用单，认 HELD（进行中）与 SETTLED（已完成）。 */
export async function readPurchasedToday(userId: string, timezone: string, now = new Date()): Promise<number> {
  const day = resolveBillingDay(now, timezone);
  const rows = await db.generationCharge.findMany({
    where: {
      userId,
      operation: 'MIRROR',
      status: {in: ['HELD', 'SETTLED']},
      // 业务日边界随时区变化，先按 48 小时粗筛，再用同一个时区函数逐条确认。
      heldAt: {gte: new Date(now.getTime() - 48 * 60 * 60 * 1000)},
    },
    select: {heldAt: true},
  });
  return rows.filter(row => resolveBillingDay(row.heldAt, timezone) === day).length;
}

/**
 * 购买能力。匿名不给买：没有余额，也没有能长期绑定的身份。
 * 未定价（coins=0）或开关关闭时 available=false，前台只会看到「额度用尽」。
 */
export function purchasePlanOf(config: MirrorConfig, anonymous: boolean): MirrorPurchase {
  const coins = Math.max(0, Math.trunc(config.purchaseCoins));
  return {enabled: config.purchaseEnabled, coins, available: config.purchaseEnabled && coins > 0 && !anonymous};
}

/** 超额且不能购买时的统一文案：区分「没开/没定价」和「今天买够了」。 */
export function purchaseBlockedReason(purchase: MirrorPurchase, policy: MirrorConfig['overLimitPolicy'], capReached = false): string {
  if (policy !== 'CHARGE' || !purchase.enabled || purchase.coins <= 0) return '今天的次数已用完，购买次数尚未开放，明天再来。';
  if (capReached) return '今天的次数和购买次数都用完了，明天再来。';
  return '今天的次数已用完，明天再来。';
}

/**
 * 开一次购买：先 hold（余额条件扣减 + 唯一负数流水 + HELD 费用单），
 * 生成成功后调用方必须 settle，失败必须 release，两者都幂等。
 */
export async function beginMirrorPurchase(input: {userId: string; requestId: string; now?: Date}): Promise<BillingTurn> {
  try {
    return await beginBillingTurn(
      {userId: input.userId, conversationId: null, operation: 'MIRROR', requestId: input.requestId},
      {now: input.now},
    );
  } catch (error) {
    const chargeError = toChargeError(error);
    if (chargeError) throw new MirrorError(chargeError.message, chargeError.status, String(chargeError.body.code ?? 'MIRROR_CHARGE_FAILED'));
    throw error;
  }
}

/** 购买单是否真的扣了币：免费模式或未定价时 held=false，调用方应回退到「额度用尽」。 */
export function isPaidPurchase(turn: BillingTurn): boolean {
  return turn.hold.held && turn.hold.allowanceSource === 'PAID' && turn.hold.coins > 0;
}
