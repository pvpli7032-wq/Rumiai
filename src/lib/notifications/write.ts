import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import type {NotificationEventInput, NotificationType} from './types';
import {replyExcerpt} from './reply-excerpt';

/**
 * 通知写入入口（仅服务端）。
 *
 * 单独成文件的原因：幂等 id 用 node:crypto 计算，而前台抽屉只借用了同目录的
 * 纯函数，客户端包一旦顺着引用链把 node:crypto 拉进浏览器，构建会直接失败
 * （UnhandledSchemeError）。所以这里放「会产生写入、依赖 node 内建模块」的部分，
 * service.ts 只保留纯函数 + 数据库读写。
 */

export class NotificationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

/** 事件键决定 id：同一用户同一类型的同一事件永远落在同一行。 */
export function notificationId(userId: string, type: NotificationType, eventKey: string): string {
  return 'ntf_' + createHash('sha256').update([userId, type, eventKey].join('\u0000')).digest('hex').slice(0, 24);
}

/** 写一条通知。同一事件重放返回既有 id，created 为 false。 */
export async function createNotification(event: NotificationEventInput): Promise<{id: string; created: boolean}> {
  const title = event.title.trim();
  if (!event.userId || !event.eventKey || !title) {
    throw new NotificationError(400, 'BAD_REQUEST', '通知缺少用户、事件键或标题。');
  }
  const id = notificationId(event.userId, event.type, event.eventKey);
  try {
    await db.notification.create({
      data: {
        id,
        userId: event.userId,
        type: event.type,
        title,
        body: event.body?.trim() || null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
      },
    });
    return {id, created: true};
  } catch (error) {
    // P2002 = 主键冲突：这条事件已经通知过，直接返回既有 id。
    if ((error as {code?: unknown})?.code === 'P2002') return {id, created: false};
    throw error;
  }
}

export interface ReviewResultEvent {
  userId: string;
  /** 审核记录 id：同一次审核只通知一次。 */
  reviewId: string;
  characterId: string;
  characterName: string;
  approved: boolean;
  reason?: string | null;
}

/** 审核结果：通过或退回都通知，点进去是那个角色。 */
export function notifyReviewResult(event: ReviewResultEvent) {
  const name = event.characterName || '未命名角色';
  const reason = event.reason?.trim();
  return createNotification({
    userId: event.userId,
    type: 'REVIEW_RESULT',
    eventKey: 'character-review:' + event.reviewId,
    title: event.approved ? '角色《' + name + '》已通过审核' : '角色《' + name + '》未通过审核',
    body: reason || (event.approved ? '现在它已经能在发现页被看到了。' : '按审核意见修改后可以重新提交。'),
    targetType: 'CHARACTER',
    targetId: event.characterId,
  });
}

export interface ReplyEvent {
  userId: string;
  /** 回复消息 id：同一条回复只提醒一次。 */
  messageId: string;
  conversationId: string;
  characterName: string;
  excerpt: string;
}

/** 回复提醒：点进去直接回到那段对话。 */
export function notifyReply(event: ReplyEvent) {
  return createNotification({
    userId: event.userId,
    type: 'REPLY',
    eventKey: 'chat-reply:' + event.messageId,
    title: (event.characterName || '角色') + ' 回复了你',
    body: replyExcerpt(event.excerpt),
    targetType: 'CONVERSATION',
    targetId: event.conversationId,
  });
}

export interface CoinsReceivedEvent {
  userId: string;
  /** 金币流水 id：同一笔入账只通知一次。 */
  transactionId: string;
  amount: number;
  reason: string;
}

/** 到账：充值、奖励、退款共用一条，点进去是金币流水。 */
export function notifyCoinsReceived(event: CoinsReceivedEvent) {
  return createNotification({
    userId: event.userId,
    type: 'COIN_RECEIVED',
    eventKey: 'coin-transaction:' + event.transactionId,
    title: '金币到账 +' + Math.max(0, Math.trunc(event.amount)),
    body: event.reason.trim() || '已记入你的金币流水。',
    targetType: 'COIN_LEDGER',
    targetId: event.transactionId,
  });
}

export interface ActivityResultEvent {
  userId: string;
  /** 活动 id：同一次活动结果只通知一次。 */
  activityId: string;
  activityName: string;
  summary: string;
}

/** 活动结果：点进去是活动榜单。 */
export function notifyActivityResult(event: ActivityResultEvent) {
  return createNotification({
    userId: event.userId,
    type: 'ACTIVITY_RESULT',
    eventKey: 'activity:' + event.activityId,
    title: (event.activityName || '活动') + '结果公布',
    body: event.summary.trim() || '结果已经公布，去看看。',
    targetType: 'ACTIVITY',
    targetId: event.activityId,
  });
}