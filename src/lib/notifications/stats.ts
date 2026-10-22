import type {Prisma} from '@prisma/client';
import {ratio} from '@/lib/ratio';
import {NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, isNotificationType} from './types';

/**
 * 后台「通知统计」（V3 第 17 章）。
 *
 * 口径：
 * - 时间范围按 notifications.created_at（发送时间）过滤，含两端；
 * - 发送量 = 该类型在区间内落表的行数，一行 = 一次实际写成的通知；
 * - 未读 = 其中 read_at IS NULL 的行；已读 = 其余（read_at 有值）；
 * - 已读率 = 已读 / 发送量，分母为 0 时返回 null（界面写「—」，不写 0%）。
 *
 * 只统计已落表的行。notifySafely 吞掉的写入失败只有一条
 * logWarning('notification_write_failed')，没有落表，因此不进本页；
 * 不为它建表、不加迁移。
 *
 * 登记过的四类即使区间内 0 条也照样出行：某个生产者停摆时那一行会归零，
 * 这是唯一能看出「某一类通知不再发送」的地方。历史遗留的未知类型按原值追加。
 */

export interface NotificationTypeStat {
  type: string;
  /** 登记类型的稳定中文名；未知历史类型回退成原始值，不硬编一个假名字。 */
  label: string;
  sent: number;
  unread: number;
  read: number;
  /** 分母为 0 时为 null。 */
  readRate: number | null;
}

export type NotificationTotals = Omit<NotificationTypeStat, 'type' | 'label'>;

export interface NotificationStats {
  generatedAt: string;
  since: string;
  days: number;
  rows: NotificationTypeStat[];
  totals: NotificationTotals;
}

/** 一次分组计数；未读与全量各调一次，避免第二份聚合实现。 */
async function countByType(tx: Prisma.TransactionClient, since: Date, until: Date, unreadOnly: boolean) {
  const groups = await tx.notification.groupBy({
    by: ['type'],
    where: {createdAt: {gte: since, lte: until}, ...(unreadOnly ? {readAt: null} : {})},
    _count: {_all: true},
  });
  return new Map(groups.map(group => [group.type, group._count._all]));
}

export async function readNotificationStats(tx: Prisma.TransactionClient, since: Date, until: Date, days: number): Promise<NotificationStats> {
  const [sent, unread] = await Promise.all([
    countByType(tx, since, until, false),
    countByType(tx, since, until, true),
  ]);

  const known = [...NOTIFICATION_TYPES];
  const unknown = [...sent.keys()].filter(type => !isNotificationType(type)).sort();
  const rows = [...known, ...unknown].map(type => {
    const total = sent.get(type) ?? 0;
    const unreadCount = unread.get(type) ?? 0;
    const readCount = total - unreadCount;
    return {
      type,
      label: isNotificationType(type) ? NOTIFICATION_TYPE_LABELS[type] : type,
      sent: total,
      unread: unreadCount,
      read: readCount,
      readRate: ratio(readCount, total),
    };
  });

  const totalSent = rows.reduce((sum, row) => sum + row.sent, 0);
  const totalUnread = rows.reduce((sum, row) => sum + row.unread, 0);
  return {
    generatedAt: until.toISOString(),
    since: since.toISOString(),
    days,
    rows,
    totals: {sent: totalSent, unread: totalUnread, read: totalSent - totalUnread, readRate: ratio(totalSent - totalUnread, totalSent)},
  };
}
