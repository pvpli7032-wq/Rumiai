import {Prisma} from '@prisma/client';
import {readAiCostReport} from '@/lib/ai/cost-report';
import {ratio} from '@/lib/ratio';

/**
 * 运营统计首轮指标（V3 §26）。
 *
 * 只算可解释的五项：生成成功率、分享后的访问、注册到首次聊天、七日回访、
 * 每个有效回复成本。所有比例分母为 0 一律返回 null（界面写「样本不足」），
 * 绝不编造 0%。成本只累加已知成本，未知成本单独计数，不按 0 计入。
 *
 * 免费/付费：用户只要有过一条支出流水（coin_transactions.type = 'SPENT'）就算付费；
 * 匿名访客没有账号，按免费计。测试/正式：users 表没有测试账号标记，只能给「全部」一档。
 */

export const AUDIENCE_TIERS = ['all', 'paid', 'free'] as const;
export type AudienceTier = (typeof AUDIENCE_TIERS)[number];

export const AUDIENCE_TIER_LABELS: Record<AudienceTier, string> = {
  all: '全部用户',
  paid: '付费用户',
  free: '免费用户（含匿名）',
};

export function parseAudienceTier(value: string | null): AudienceTier {
  if (!value) return 'all';
  return (AUDIENCE_TIERS as readonly string[]).includes(value) ? (value as AudienceTier) : 'all';
}

/** 归属表达式：登录优先，其次匿名主体。 */
const identityOf = (alias: string) =>
  `CASE WHEN ${alias}.user_id IS NOT NULL THEN 'u:' || ${alias}.user_id WHEN ${alias}.anonymous_subject IS NOT NULL THEN 'a:' || ${alias}.anonymous_subject ELSE NULL END`;

/** 付费用户集合：有过支出流水。含被删除账号的流水，付费事实不随账号消失。 */
const PAID_USERS = `(SELECT DISTINCT user_id FROM coin_transactions WHERE type = 'SPENT' AND user_id IS NOT NULL)`;

/** product_events 的档位条件。 */
function eventTier(tier: AudienceTier): string {
  if (tier === 'paid') return `p.user_id IN ${PAID_USERS}`;
  if (tier === 'free') return `(p.user_id IS NULL OR p.user_id NOT IN ${PAID_USERS})`;
  return '1 = 1';
}

/** 按用户列过滤的档位条件（ai_calls.user_id / conversations.user_id / users.id）。 */
function userTier(tier: AudienceTier, column: string): string {
  if (tier === 'paid') return `${column} IN ${PAID_USERS}`;
  if (tier === 'free') return `(${column} IS NULL OR ${column} NOT IN ${PAID_USERS})`;
  return '1 = 1';
}

export interface RatioMetric {
  key: 'mirrorSuccess' | 'shareAfterComplete' | 'inviteFirstChat' | 'sevenDayReturn' | 'freeReplyShare' | 'paidReplyShare';
  label: string;
  /** 分子与分母各自的口径，界面上逐项标注。 */
  formula: string;
  numerator: number;
  denominator: number;
  /** 分母为 0 时为 null：界面显示「样本不足」。 */
  value: number | null;
}

/**
 * 回复的免费/收费构成（V3 表 22 财务观察「收费回复数、免费占比」）。
 *
 * 分母是区间内**已结算**的费用单：HELD 还没定价、RELEASED 是退掉的、UNKNOWN 是结果
 * 不明，把它们算进来会让「免费占比」随未完成的事情漂移。allowanceSource 为
 * FREE_QUOTA（用掉每日免费额度）或 FREE_MODE（整站免费模式）都算免费回复，其余算收费。
 */
export interface ReplyMix {
  free: number;
  paid: number;
  total: number;
  /** 分母为 0 时为 null，界面显示「样本不足」。 */
  freeShare: number | null;
}

export interface CostPerReplyRow {
  currency: string;
  /** 已知成本合计（未知成本不计入）。 */
  knownCost: number;
  /** 已知成本的调用数。 */
  knownCostCalls: number;
  /** 未知成本调用数：单列，不按 0 计入分子。 */
  unknownCostCalls: number;
  /** 区间内有效回复数（ASSISTANT 消息）。 */
  replies: number;
  costPerReply: number | null;
}

export interface OpsMetrics {
  tier: AudienceTier;
  tierLabel: string;
  tierOptions: Array<{key: AudienceTier; label: string}>;
  /** 测试/正式：只有「全部」一档，附原因。 */
  testTier: {key: 'all'; label: string; note: string};
  ratios: RatioMetric[];
  replyMix: ReplyMix;
  costPerReply: CostPerReplyRow[];
  costNote: string;
  definitions: Record<string, string>;
}

async function countPeople(tx: Prisma.TransactionClient, events: string[], since: Date, until: Date, tier: AudienceTier): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<Array<{event: string; people: number}>>(Prisma.sql`
    SELECT p.name AS event, COUNT(DISTINCT ${Prisma.raw(identityOf('p'))}) AS people
      FROM product_events p
     WHERE p.name IN (${Prisma.join(events)}) AND p.created_at >= ${since} AND p.created_at <= ${until}
       AND ${Prisma.raw(eventTier(tier))}
     GROUP BY p.name
  `);
  return new Map(rows.map(row => [row.event, Number(row.people) || 0]));
}

/** 有分享访问、且此前完成过生成的主体数：完成事件不限窗口，只要求早于那次分享访问。 */
async function countShareAfterComplete(tx: Prisma.TransactionClient, since: Date, until: Date, tier: AudienceTier): Promise<number> {
  const rows = await tx.$queryRaw<Array<{people: number}>>(Prisma.sql`
    SELECT COUNT(*) AS people FROM (
      SELECT ${Prisma.raw(identityOf('p'))} AS id, MIN(p.created_at) AS first_seen
        FROM product_events p
       WHERE p.name = 'mirror_share_viewed' AND p.created_at >= ${since} AND p.created_at <= ${until}
         AND ${Prisma.raw(eventTier(tier))}
       GROUP BY id
    ) v
    WHERE EXISTS (
      SELECT 1 FROM product_events c
       WHERE c.name = 'mirror_completed' AND ${Prisma.raw(identityOf('c'))} = v.id AND c.created_at <= v.first_seen
    )
  `);
  return Number(rows[0]?.people ?? 0) || 0;
}

/** 七日回访：注册满 7 天的账号里，第 7 天后仍有任一玩法事件的比例。 */
async function countSevenDayReturn(tx: Prisma.TransactionClient, until: Date, tier: AudienceTier): Promise<{cohort: number; returned: number}> {
  const until7 = new Date(until.getTime() - 7 * 86_400_000);
  const rows = await tx.$queryRaw<Array<{cohort: number; returned: number}>>(Prisma.sql`
    SELECT COUNT(*) AS cohort,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM product_events e
         WHERE e.user_id = u.id AND e.created_at >= u.created_at + 604800000 AND e.created_at <= ${until}
      ) THEN 1 ELSE 0 END) AS returned
      FROM users u
     WHERE u.deleted_at IS NULL AND u.created_at <= ${until7} AND ${Prisma.raw(userTier(tier, 'u.id'))}
  `);
  return {cohort: Number(rows[0]?.cohort ?? 0) || 0, returned: Number(rows[0]?.returned ?? 0) || 0};
}

/**
 * 每个有效回复成本：已知 AI 成本 / 有效回复数，按币种分行。
 *
 * 成本聚合只走 readAiCostReport 这一条链（内部即 classifyAiCostGroup），
 * 这里不再自己 groupBy，否则同一口径会出现第二份实现并各自漂移。
 * 已知成本为 0 次调用时比率为 null：把「全是未知成本」显示成 0 就是编造。
 * 成本不按免费/付费拆：拆开就要复制一份成本聚合，得不偿失；人数类指标才分档。
 */
async function readCostPerReply(tx: Prisma.TransactionClient, since: Date, until: Date): Promise<CostPerReplyRow[]> {
  const [costs, replies] = await Promise.all([
    readAiCostReport(tx, since, until),
    tx.message.count({where: {role: 'ASSISTANT', createdAt: {gte: since, lte: until}}}),
  ]);
  return costs
    .filter(row => row.realCalls > 0)
    .map(row => ({
      currency: row.currency,
      knownCost: row.estimatedCost,
      knownCostCalls: row.knownCostCalls,
      unknownCostCalls: row.unknownCostCalls,
      replies,
      costPerReply: row.knownCostCalls > 0 ? ratio(row.estimatedCost, replies) : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

async function readReplyMix(tx: Prisma.TransactionClient, since: Date, until: Date): Promise<ReplyMix> {
  const rows = await tx.generationCharge.groupBy({
    by: ['allowanceSource'],
    where: {status: 'SETTLED', settledAt: {gte: since, lte: until}},
    _count: {_all: true},
  });
  let free = 0;
  let paid = 0;
  for (const row of rows) {
    const count = row._count._all;
    if (row.allowanceSource === 'FREE_QUOTA' || row.allowanceSource === 'FREE_MODE') free += count;
    else paid += count;
  }
  return {free, paid, total: free + paid, freeShare: ratio(free, free + paid)};
}

export async function readOpsMetrics(tx: Prisma.TransactionClient, since: Date, until: Date, tier: AudienceTier): Promise<OpsMetrics> {
  const [counts, shareAfterComplete, sevenDay, costPerReply, replyMix] = await Promise.all([
    countPeople(tx, ['mirror_started', 'mirror_completed', 'mirror_share_viewed', 'invite_registered', 'invite_first_chat'], since, until, tier),
    countShareAfterComplete(tx, since, until, tier),
    countSevenDayReturn(tx, until, tier),
    readCostPerReply(tx, since, until),
    readReplyMix(tx, since, until),
  ]);
  const started = counts.get('mirror_started') ?? 0;
  const completed = counts.get('mirror_completed') ?? 0;
  const sharedViewers = counts.get('mirror_share_viewed') ?? 0;
  const registered = counts.get('invite_registered') ?? 0;
  const firstChat = counts.get('invite_first_chat') ?? 0;
  return {
    tier,
    tierLabel: AUDIENCE_TIER_LABELS[tier],
    tierOptions: AUDIENCE_TIERS.map(key => ({key, label: AUDIENCE_TIER_LABELS[key]})),
    testTier: {
      key: 'all',
      label: '全部结果（含测试）',
      note: '账号表没有测试标记字段，测试与正式无法按数据区分，因此只提供「全部」一档；需要分开时先给账号加标记再启用筛选。',
    },
    ratios: [
      {key: 'mirrorSuccess', label: '生成成功率', formula: '生成完成人数 / 开始答题人数', numerator: completed, denominator: started, value: ratio(completed, started)},
      {key: 'shareAfterComplete', label: '分享后的访问', formula: '完成过生成、且之后打开过分享页的人数 / 打开过分享页的人数', numerator: shareAfterComplete, denominator: sharedViewers, value: ratio(shareAfterComplete, sharedViewers)},
      {key: 'inviteFirstChat', label: '注册到首次聊天', formula: '完成首次聊天人数 / 注册归属人数', numerator: firstChat, denominator: registered, value: ratio(firstChat, registered)},
      {key: 'sevenDayReturn', label: '七日回访', formula: '注册满 7 天后仍有玩法事件的人数 / 注册满 7 天的账号数', numerator: sevenDay.returned, denominator: sevenDay.cohort, value: ratio(sevenDay.returned, sevenDay.cohort)},
      // 免费与收费是同一分母的两个补集：两张卡片并排读，收费回复数就是这一项的分子。
      {key: 'freeReplyShare', label: '免费占比', formula: '免费回复数 / 全部已结算回复数', numerator: replyMix.free, denominator: replyMix.total, value: replyMix.freeShare},
      {key: 'paidReplyShare', label: '收费回复数占比', formula: '收费回复数 / 全部已结算回复数（分子即收费回复数）', numerator: replyMix.paid, denominator: replyMix.total, value: ratio(replyMix.paid, replyMix.total)},
    ],
    replyMix,
    costPerReply,
    costNote: '成本聚合与「AI 调用与成本估算」面板同一条链：分子只含已知成本，多次尝试、缺用量或缺价格的调用记为未知成本，单列条数，不按 0 计入分子；分母是区间内 ASSISTANT 消息数。成本不按免费/付费拆档，人数类指标才分档。',
    definitions: {
      people: '人数口径与漏斗一致：登录按 userId、匿名按服务端签发的匿名主体去重。',
      paid: '付费 = 有过一条支出流水（coin_transactions.type = SPENT），不按充值金额；匿名访客没有账号，按免费计。',
      sample: '分母为 0 时显示「样本不足」，不显示 0%。',
      shareAfterComplete: '完成事件不限窗口，只要求早于那次分享访问；分享访问本身必须落在窗口内。',
      sevenDay: '分母只含注册满 7 天且未删除的账号；分子要求注册后第 7 天起、窗口结束前存在任一玩法事件。',
      replyMix: '免费/收费按已结算费用单的 allowanceSource 聚合：FREE_QUOTA（用掉每日免费额度）与 FREE_MODE（整站免费模式）算免费，其余算收费。分母不含 HELD（还没定价）、RELEASED（已退回）与 UNKNOWN（结果不明），否则占比会随未完成的事漂移。这一项是全量聚合，不是某一页的行数。',
    },
  };
}
