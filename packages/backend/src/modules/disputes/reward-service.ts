import type {Prisma} from '@prisma/client';
import {readBillingTimezone} from '@rumiai/backend/modules/billing/allowance';
import {grantEarnedCoins, isDuplicateReward} from '@rumiai/backend/modules/coins/reward-ledger';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {resolveZonedDay} from '@rumiai/backend/infrastructure/time/zoned-day';

/**
 * 评理广场奖励（V3 表 9 / 表 20）。
 *
 * - 金额未填或为 0 就不发，也不写流水；不报错，不影响投票与结案本身。
 * - 发放走现有账本（grantEarnedCoins），靠 coin_transactions.reward_key 唯一键幂等：
 *   同一业务键第二次写入会撞唯一约束，整笔事务回滚，不会重复发币。
 * - 每日上限按 billing.dayTimezone 的业务日统计当日已发的评理奖励，超出部分按剩余额度截断。
 * - 奖励在投票 / 结案各自的事务之外单独发：发奖失败不能回滚用户已经提交的投票或结案。
 */

/** 评理奖励的业务键前缀，也是每日上限的统计口径。 */
const DISPUTE_REWARD_PREFIX = 'dispute-';
const DAY_MS = 86_400_000;

interface DisputeRewardRules {
  participateCoins: number;
  hotCoins: number;
  hotTopN: number;
  dailyCapCoins: number;
}

/** 设置值一律当非负整数用：小数、负数、非数字都按 0 处理，不让脏值变成负发放。 */
function wholeCoins(value: unknown, max: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
}

async function readDisputeRewardRules(): Promise<DisputeRewardRules> {
  const [participate, hot, topN, cap] = await Promise.all([
    readSettingValue<number>('dispute.participateRewardCoins'),
    readSettingValue<number>('dispute.hotRewardCoins'),
    readSettingValue<number>('dispute.hotRewardTopN'),
    readSettingValue<number>('dispute.rewardDailyCapCoins'),
  ]);
  return {
    participateCoins: wholeCoins(participate, 1000),
    hotCoins: wholeCoins(hot, 10_000),
    hotTopN: Math.max(1, wholeCoins(topN, 50)),
    dailyCapCoins: wholeCoins(cap, 100_000),
  };
}

/**
 * 当日已发放的评理奖励总额。
 *
 * 业务日按 billing.dayTimezone 切（V3 表 8）。跨时区的零点换算已经有 zoned-day 一份实现，
 * 这里不再写第二套：先按 48 小时窗口取候选流水，再用同一个 resolveZonedDay 逐行判断属于哪个业务日。
 * 奖励发放一天只有几十次，逐行判断比复制一份时区算术更划算。
 */
async function readUsedToday(tx: Prisma.TransactionClient, userId: string, now: Date, timezone: string): Promise<number> {
  const day = resolveZonedDay(now, timezone);
  const rows = await tx.coinTransaction.findMany({
    where: {userId, amount: {gt: 0}, rewardKey: {startsWith: DISPUTE_REWARD_PREFIX}, createdAt: {gte: new Date(now.getTime() - 2 * DAY_MS), lte: now}},
    select: {amount: true, createdAt: true},
  });
  return rows.reduce((sum, row) => (resolveZonedDay(row.createdAt, timezone) === day ? sum + row.amount : sum), 0);
}

interface GrantInput {
  userId: string;
  caseId: string;
  rewardKey: string;
  coins: number;
  cap: number;
  description: string;
  sourceKey: string;
}

/** 发一笔评理奖励。金额为 0、额度用尽、已发过都静默跳过。 */
async function grant(input: GrantInput): Promise<void> {
  if (input.coins <= 0) return;
  await pragmasReady;
  const now = new Date();
  const timezone = input.cap > 0 ? await readBillingTimezone() : 'UTC';
  try {
    await db.$transaction(async tx => {
      // 上限与发放读写在同一个事务里：并发发奖不会各自读到「还有额度」而一起超发。
      const used = input.cap > 0 ? await readUsedToday(tx, input.userId, now, timezone) : 0;
      const amount = input.cap > 0 ? Math.min(input.coins, Math.max(0, input.cap - used)) : input.coins;
      if (amount <= 0) return;
      await grantEarnedCoins(tx, input.userId, amount, input.description, input.sourceKey, input.rewardKey);
    });
  } catch (error) {
    // 唯一业务键冲突说明这一笔已经发过，是幂等命中，不是失败。
    if (isDuplicateReward(error)) return;
    logWarning('dispute_reward_failed', {caseId: input.caseId, userId: input.userId, rewardKey: input.rewardKey, error: error instanceof Error ? error.message : String(error)});
  }
}

/** 参与奖：每个案例每人只发一次，改票命中同一业务键，不会重复发。 */
export async function awardVoteReward(caseId: string, userId: string): Promise<void> {
  const rules = await readDisputeRewardRules();
  await grant({
    userId, caseId, coins: rules.participateCoins, cap: rules.dailyCapCoins,
    rewardKey: `${DISPUTE_REWARD_PREFIX}vote:${caseId}:${userId}`,
    description: '评理广场：参与投票奖励',
    sourceKey: 'DISPUTE_VOTE_REWARD',
  });
}

/** 热门奖：结案时按案例内投票先后取前 hotRewardTopN 名（每人一票，同票先投者优先）。 */
export async function awardHotRewards(caseId: string): Promise<void> {
  const rules = await readDisputeRewardRules();
  if (rules.hotCoins <= 0) return;
  await pragmasReady;
  const voters = await db.disputeVote.findMany({
    where: {caseId},
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    take: rules.hotTopN,
    select: {userId: true},
  });
  for (const voter of voters) {
    await grant({
      userId: voter.userId, caseId, coins: rules.hotCoins, cap: rules.dailyCapCoins,
      rewardKey: `${DISPUTE_REWARD_PREFIX}hot:${caseId}:${voter.userId}`,
      description: '评理广场：热门案例奖励',
      sourceKey: 'DISPUTE_HOT_REWARD',
    });
  }
}
