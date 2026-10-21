/**
 * 站内通知的对外形状（V3 第 26 章）。
 *
 * 一套 `notifications` 表服务全部通知场景，首版只做四类事件：审核结果、
 * 回复提醒、到账、活动结果。不做邮件、短信或多渠道推送——那需要一个独立
 * 的投递平台，V3 明确后置。
 */

export const NOTIFICATION_TYPES = ['REVIEW_RESULT', 'REPLY', 'COIN_RECEIVED', 'ACTIVITY_RESULT'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 抽屉与列表上的中文标签。 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  REVIEW_RESULT: '审核结果',
  REPLY: '回复提醒',
  COIN_RECEIVED: '到账',
  ACTIVITY_RESULT: '活动结果',
};

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * 读取历史行时的兜底标签：类型不在登记表里也照常显示，不丢通知。
 * 写入端仍受 `NotificationType` 约束，兜底只服务于读。
 */
export function notificationTypeLabel(value: string): string {
  return isNotificationType(value) ? NOTIFICATION_TYPE_LABELS[value] : '通知';
}

/**
 * 通知指向的业务对象。只有登记在这里的类型才有跳转地址，新增目标必须同时
 * 在 `notificationHref` 里给出路径，避免出现点了没反应的死链。
 */
export const NOTIFICATION_TARGET_TYPES = ['CHARACTER', 'CONVERSATION', 'COIN_LEDGER', 'ACTIVITY'] as const;
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

function isTargetType(value: string): value is NotificationTargetType {
  return (NOTIFICATION_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * 业务对象 -> 前台路径。没有登记的目标返回 null：那条通知在抽屉里只读，
 * 不会渲染成点了没反应的链接。纯函数，前后端共用。
 */
export function notificationHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !isTargetType(targetType)) return null;
  switch (targetType) {
    case 'CHARACTER':
      return targetId ? '/zh/character/' + encodeURIComponent(targetId) : null;
    case 'CONVERSATION':
      return targetId ? '/chat?conversation=' + encodeURIComponent(targetId) : null;
    case 'COIN_LEDGER':
      return '/shop/ledger';
    case 'ACTIVITY':
      return '/leaderboard';
    default:
      return null;
  }
}

export interface NotificationItem {
  id: string;
  /** 数据库里的原始类型；未知类型也照常返回，界面用兜底标签显示。 */
  type: string;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  /** 点击后进入的业务对象路径；目标缺失或类型未登记时为 null（只读，不跳转）。 */
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  /** 全量未读计数：顶栏红点与抽屉共用同一个数，两处天然一致。 */
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationEventInput {
  userId: string;
  type: NotificationType;
  /** 业务事件唯一键。同一用户 + 类型 + 事件键只落一条，重放不重复通知。 */
  eventKey: string;
  title: string;
  body?: string | null;
  targetType?: NotificationTargetType | null;
  targetId?: string | null;
}
