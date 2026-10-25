import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';
import type {ProductEventName as ContractProductEventName} from '@rumiai/contracts/analytics';

/**
 * 玩法埋点（V3 表 5 AnalyticsEvent、表 22 玩法漏斗）。
 *
 * 一张 `product_events` 表承接全部玩法事件，不另建每玩法一套。事件名即存储值，
 * 客户端与服务端共用这份清单。
 *
 * 写入口径：只写服务端能核验的事实。访问类事件由客户端上报，服务端补 userId；
 * 完成类事件一律由服务端在真实结果落库后写，不接受客户端自称完成。
 */
export const PRODUCT_EVENTS = [
  // 他眼中的你：访问 → 开始 → 生成完成 → 分享访问 → 转聊天
  'mirror_visited',
  'mirror_started',
  'mirror_completed',
  'mirror_share_viewed',
  'mirror_to_chat',
  // 评理广场：访问 → 发起 → 投票 → 结案
  'dispute_visited',
  'dispute_started',
  'dispute_voted',
  'dispute_closed',
  // 邀请：分享链接访问 → 注册归属 → 首次聊天
  'invite_visited',
  'invite_registered',
  'invite_first_chat',
  'chat_opened',
] as const;

export type ProductEventName = ContractProductEventName;

/** 事件名到中文标签：后台漏斗直接展示，不在组件里再写一份映射。 */
export const PRODUCT_EVENT_LABELS: Record<ProductEventName, string> = {
  mirror_visited: '他眼中的你 · 访问',
  mirror_started: '他眼中的你 · 开始答题',
  mirror_completed: '他眼中的你 · 生成完成',
  mirror_share_viewed: '他眼中的你 · 分享访问',
  mirror_to_chat: '他眼中的你 · 转去聊天',
  dispute_visited: '评理广场 · 访问',
  dispute_started: '评理广场 · 发起案例',
  dispute_voted: '评理广场 · 投票',
  dispute_closed: '评理广场 · 结案',
  invite_visited: '邀请 · 链接访问',
  invite_registered: '邀请 · 注册归属',
  invite_first_chat: '邀请 · 首次聊天',
  chat_opened: '聊天 · 打开会话',
};

export function isProductEvent(value: string): value is ProductEventName {
  return (PRODUCT_EVENTS as readonly string[]).includes(value);
}

interface RecordInput {
  event: ProductEventName;
  /** 登录用户；匿名事件留空。 */
  userId?: string | null;
  /** 匿名的稳定标识（加盐哈希，不存原文）。 */
  anonymousSubject?: string | null;
  /** 业务对象：分享码、案例 id、邀请码等，用于去重与关联。 */
  subjectKey?: string | null;
  properties?: Record<string, string | number | boolean | null>;
}

/**
 * 写一条玩法事件。
 *
 * 埋点不是主流程：写失败只记日志，绝不因为统计出错让生成或投票失败。
 * 同一 (event, subjectKey, userId) 重复写入是正常的（访问可以多次），
 * 需要「只算一次」的语义由读侧按 DISTINCT 处理，不在写侧丢弃事实。
 */
/**
 * 按保留天数删除更早的玩法事件（V3 表 9 增长「事件默认 180 天」）。
 *
 * 由后台任务 `event-cleanup` 调用，返回删除条数写进任务结果。
 */
export async function pruneProductEvents(retentionDays: number, now = new Date()): Promise<number> {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 180;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  await pragmasReady;
  const result = await db.productEvent.deleteMany({where: {createdAt: {lt: cutoff}}});
  return result.count;
}

export async function recordProductEvent(input: RecordInput): Promise<void> {
  try {
    await pragmasReady;
    await db.productEvent.create({
      data: {
        name: input.event,
        userId: input.userId ?? null,
        anonymousSubject: input.anonymousSubject ?? null,
        subjectKey: input.subjectKey ?? null,
        propertiesJson: input.properties ? JSON.stringify(input.properties) : null,
      },
    });
  } catch (error) {
    logWarning('product_event_write_failed', {event: input.event, error: error instanceof Error ? error.message : String(error)});
  }
}
