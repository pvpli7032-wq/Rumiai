import {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {ratio as rate} from '@/lib/ratio';
import {PRODUCT_EVENT_LABELS, type ProductEventName} from './product-events';

/**
 * 玩法漏斗报表（V3 表 22、§26）。
 *
 * 口径：
 * - 分子分母都是 COUNT(DISTINCT 归属)：登录算 userId，匿名算 anonymousSubject，
 *   两者加前缀区分，避免同一个字符串在两条通道里被当成同一个人。
 * - 分母为 0 时比率为 null（界面显示「样本不足」），绝不显示 0%。
 * - 只统计落在统计窗口内的访问事实；后续节点也要求落在窗口内，
 *   与运营分析 overview 的「同周期」口径一致，不做跨周期回溯。
 */

export class ProductFunnelReportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'ProductFunnelReportError';
  }
}

export interface FunnelStep {
  event: ProductEventName;
  label: string;
  people: number;
  /** 相对第一步的整体转化率；分母为 0 时为 null。 */
  rateFromStart: number | null;
  /** 相对上一步的转化率；上一步为 0 时为 null。跨人群的环节用自己的分母。 */
  rateFromPrevious: number | null;
}

/**
 * 漏斗的一环。
 *
 * `from` 只在「这一环的人不是上一环那批人」时才写：分享访问与转去聊天属于扩散与
 * 去向，不是完成生成那批人的下一格，拿它们去除以上一步（分享访问）会得到一个
 * 谁也解释不了的百分比。所以这两环固定除以 `from` 指定的人数。
 */
interface FunnelStepInput {
  event: ProductEventName;
  from?: ProductEventName;
}

export interface Funnel {
  key: 'mirror' | 'dispute' | 'invite';
  title: string;
  description: string;
  steps: FunnelStep[];
  /** 端到端转化率：最后一步 / 第一步。 */
  overallRate: number | null;
}

export interface ProductFunnelReport {
  generatedAt: string;
  since: string;
  days: number;
  funnels: Funnel[];
  definitions: Record<string, string>;
}

/** 归属表达式：登录优先，其次匿名主体；两者都没有的行不计入任何人数。 */
const IDENTITY = "CASE WHEN user_id IS NOT NULL THEN 'u:' || user_id WHEN anonymous_subject IS NOT NULL THEN 'a:' || anonymous_subject ELSE NULL END";

interface CountRow {
  event: string;
  people: number;
}

async function countPeople(events: readonly ProductEventName[], since: Date, until: Date): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT name AS event, COUNT(DISTINCT ${Prisma.raw(IDENTITY)}) AS people
      FROM product_events
     WHERE name IN (${Prisma.join([...events])}) AND created_at >= ${since} AND created_at <= ${until}
     GROUP BY name
  `);
  return new Map(rows.map(row => [row.event, Number(row.people) || 0]));
}

function buildFunnel(
  key: Funnel['key'],
  title: string,
  description: string,
  input: readonly FunnelStepInput[],
  counts: Map<string, number>,
): Funnel {
  const people = input.map(step => counts.get(step.event) ?? 0);
  const start = people[0] ?? 0;
  const steps: FunnelStep[] = input.map((step, index) => ({
    event: step.event,
    label: PRODUCT_EVENT_LABELS[step.event],
    people: people[index] ?? 0,
    rateFromStart: rate(people[index] ?? 0, start),
    rateFromPrevious: index === 0 ? null : rate(people[index] ?? 0, step.from ? counts.get(step.from) ?? 0 : people[index - 1] ?? 0),
  }));
  return {
    key,
    title,
    description,
    steps,
    overallRate: rate(people[people.length - 1] ?? 0, start),
  };
}

export async function readProductFunnelReport(actorId: string, days: number): Promise<ProductFunnelReport> {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ProductFunnelReportError('统计天数必须为 1–90 的整数。');
  await pragmasReady;
  return db.$transaction(async tx => {
    if (!await hasAdminPermission(actorId, 'analytics.read', tx)) throw new ProductFunnelReportError('当前账号没有运营分析权限。', 403);
    const generatedAt = new Date();
    const since = new Date(generatedAt.getTime() - days * 86_400_000);
    const counts = await countPeople(
      ['mirror_visited', 'mirror_started', 'mirror_completed', 'mirror_share_viewed', 'mirror_to_chat', 'dispute_visited', 'dispute_started', 'dispute_voted', 'dispute_closed', 'invite_visited', 'invite_registered', 'invite_first_chat'],
      since,
      generatedAt,
    );
    return {
      generatedAt: generatedAt.toISOString(),
      since: since.toISOString(),
      days,
      funnels: [
        buildFunnel('mirror', '他眼中的你', '访问 → 开始答题 → 生成完成 → 分享访问 → 转去聊天。前三环是同一批人的转化；后两环是扩散与去向，分母固定为生成完成人数（打开别人分享页的人不是完成生成的那批人，用上一步做分母会得到看不懂的百分比）。完成事件由服务端在结果落库后写，不接受客户端自称完成。', [
          {event: 'mirror_visited'},
          {event: 'mirror_started'},
          {event: 'mirror_completed'},
          {event: 'mirror_share_viewed', from: 'mirror_completed'},
          {event: 'mirror_to_chat', from: 'mirror_completed'},
        ], counts),
        buildFunnel('dispute', '评理广场', '访问 → 发起案例 → 投票 → 结案。发起、投票、结案都由评理服务端在事务内写。', [
          {event: 'dispute_visited'},
          {event: 'dispute_started'},
          {event: 'dispute_voted'},
          {event: 'dispute_closed'},
        ], counts),
        buildFunnel('invite', '邀请', '分享链接访问 → 注册归属 → 首次聊天。访问由邀请链接的落地路由写，注册与首次聊天由账号与聊天服务端写。', [
          {event: 'invite_visited'},
          {event: 'invite_registered'},
          {event: 'invite_first_chat'},
        ], counts),
      ],
      definitions: {
        people: '人数口径：登录用户按 userId 去重，匿名访客按服务端签发的匿名主体去重；同一人在两条通道不会被合并。',
        window: '只统计落在统计窗口内的事件，与运营分析其他面板同周期。',
        sample: '分母为 0 时显示「样本不足」，不当作 0% 展示。',
        completed: '生成完成、投票、结案、注册这类事实只由服务端写，客户端上报无法伪造。',
        mirrorReach: '分享访问与转去聊天不是「完成生成」的下一步：打开分享页的是别人，转去聊天的人可能来自分享页也可能来自自己的结果页。这两环的「上一步」分母固定为生成完成人数，读作「每 100 个完成生成的人，对应多少人做了这件事」，不是同一批人的转化率。',
      },
    };
  });
}
