import type {Prisma} from '@prisma/client';
import {readSettingValue} from '@/lib/settings';
import {db} from '@/lib/db';
import type {DisputeExcerptOptions, DisputeRuleSnapshot} from './types';
import {isDisputeRules} from './types';

/**
 * 评理广场的运营规则：读取、冻结成快照、从快照还原。
 *
 * 规则在案例创建那一刻冻结进 rule_snapshot_json，之后后台改设置不影响已开案例；
 * 所以读取只发生在「发起」和「展示当前可选参数」两处，投票与结案一律读快照。
 */

/** 案例挂在系统圈子里：它给评论、点赞、举报一个落点，但不在圈子列表里做推荐。 */
export const DISPUTE_TOPIC_ID = 'xingban-topic-disputes';
export const DISPUTE_TOPIC_NAME = '评理广场';
const DISPUTE_TOPIC_DESCRIPTION = '谁更有理：从聊天摘出片段，写明诉求，让大家投票。评论、点赞与举报沿用社区规则。';
const DISPUTE_TOPIC_TAGS = '评理,社区';

/** 案例挂靠的系统圈子：不存在就建，建一次之后一直复用。 */
export async function ensureDisputeTopic(tx: Prisma.TransactionClient) {
  const existing = await tx.circle.findUnique({where: {id: DISPUTE_TOPIC_ID}, select: {id: true}});
  if (existing) return;
  await tx.circle.create({data: {id: DISPUTE_TOPIC_ID, name: DISPUTE_TOPIC_NAME, description: DISPUTE_TOPIC_DESCRIPTION, tags: DISPUTE_TOPIC_TAGS, ownerId: null, status: 'ACTIVE'}});
}

/** 业务日按 Asia/Shanghai 切：每日发起限制不会随 UTC 零点漂移。 */
const DISPUTE_DAY_OFFSET_MS = 8 * 3_600_000;
export const HOUR_MS = 3_600_000;

export function disputeDayStart(now = new Date()) {
  const shifted = new Date(now.getTime() + DISPUTE_DAY_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - DISPUTE_DAY_OFFSET_MS);
}

/**
 * 读运营规则。必须在真正执行动作时读：设置值不允许导出成模块顶层常量，
 * 否则后台改完不生效。
 */
export async function readDisputeOptions(userId?: string | null): Promise<DisputeExcerptOptions> {
  const [enabled, maxExcerptMessages, claimMaxChars, dailyLimit, minAccountAgeHours, maxVoteChanges, closeAfterHours, closeAtVotes, verdictMaxChars] = await Promise.all([
    readSettingValue<boolean>('dispute.enabled'),
    readSettingValue<number>('dispute.maxExcerptMessages'),
    readSettingValue<number>('dispute.claimMaxChars'),
    readSettingValue<number>('dispute.dailyLimit'),
    readSettingValue<number>('dispute.minAccountAgeHours'),
    readSettingValue<number>('dispute.maxVoteChanges'),
    readSettingValue<number>('dispute.closeAfterHours'),
    readSettingValue<number>('dispute.closeAtVotes'),
    readSettingValue<number>('dispute.verdictMaxChars'),
  ]);
  const base = {maxExcerptMessages: Number(maxExcerptMessages), claimMaxChars: Number(claimMaxChars), dailyLimit: Number(dailyLimit), minAccountAgeHours: Number(minAccountAgeHours), maxVoteChanges: Number(maxVoteChanges), closeAfterHours: Number(closeAfterHours), closeAtVotes: Number(closeAtVotes), verdictMaxChars: Number(verdictMaxChars)};
  if (!userId) return {...base, enabled: Boolean(enabled), remaining: null, eligible: null, topicName: DISPUTE_TOPIC_NAME};
  const [user, used] = await Promise.all([
    db.user.findUnique({where: {id: userId}, select: {createdAt: true, deletedAt: true, suspendedAt: true}}),
    db.disputeCase.count({where: {authorId: userId, createdAt: {gte: disputeDayStart()}}}),
  ]);
  const ageHours = user ? (Date.now() - user.createdAt.getTime()) / HOUR_MS : 0;
  const valid = Boolean(user && !user.deletedAt && !user.suspendedAt);
  return {...base, enabled: Boolean(enabled), remaining: valid ? Math.max(0, base.dailyLimit - used) : 0, eligible: valid && ageHours >= base.minAccountAgeHours, topicName: DISPUTE_TOPIC_NAME};
}

/** 把当前设置冻结成快照。创建时只写一次，之后的投票与结案都读快照。 */
export function buildRuleSnapshot(options: DisputeExcerptOptions, now = new Date()): DisputeRuleSnapshot {
  return {
    version: 1,
    capturedAt: now.toISOString(),
    closeAfterHours: options.closeAfterHours,
    closeAtVotes: options.closeAtVotes,
    maxVoteChanges: options.maxVoteChanges,
    verdictMaxChars: options.verdictMaxChars,
    maxExcerptMessages: options.maxExcerptMessages,
    claimMaxChars: options.claimMaxChars,
  };
}

export function snapshotOf(raw: string): DisputeRuleSnapshot {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDisputeRules(parsed) ? parsed : fallbackRules();
  } catch {
    return fallbackRules();
  }
}

/** 历史脏数据兜底：按 V3 默认值，不抛错让详情整页打不开。 */
function fallbackRules(): DisputeRuleSnapshot {
  return {version: 1, capturedAt: '', closeAfterHours: 48, closeAtVotes: 200, maxVoteChanges: 1, verdictMaxChars: 120, maxExcerptMessages: 6, claimMaxChars: 60};
}
