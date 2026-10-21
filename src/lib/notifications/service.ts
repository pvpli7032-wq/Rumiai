import {db} from '@/lib/db';
import {NotificationError} from './write';
import {notificationHref, type NotificationItem, type NotificationPage} from './types';

/**
 * 站内通知读取与已读（V3 第 26 章）。写入与事件生产者见 `./write`。
 *
 * 这里只依赖 Prisma 与纯函数：前台抽屉会引用本文件的纯函数，客户端包绝不能
 * 顺着引用链把 node 内建模块拉进来。
 */

export {NotificationError, createNotification, notificationId} from './write';
export {notificationHref} from './types';
export {
  notifyActivityResult,
  notifyCoinsReceived,
  notifyReply,
  notifyReviewResult,
} from './write';

const MAX_PAGE_SIZE = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function toItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    targetType: row.targetType,
    targetId: row.targetId,
    href: notificationHref(row.targetType, row.targetId),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 默认一页 20 条：抽屉首屏够用，翻页仍走游标。 */
const NOTIFICATION_PAGE_SIZE = 20;

export function countUnread(userId: string): Promise<number> {
  return db.notification.count({where: {userId, readAt: null}});
}

/**
 * 一页通知 + 全量未读计数。计数与列表读同一张表，顶栏红点和抽屉不会各算各的。
 * 游标用 id（与 createdAt 同序，主键唯一），非法游标直接忽略回到第一页。
 */
export async function listNotifications(
  userId: string,
  options: {cursor?: string | null; take?: number} = {},
): Promise<NotificationPage> {
  const take = Math.min(Math.max(Math.trunc(options.take ?? NOTIFICATION_PAGE_SIZE) || NOTIFICATION_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = options.cursor && ID_PATTERN.test(options.cursor) ? options.cursor : null;
  const [unreadCount, rows] = await Promise.all([
    countUnread(userId),
    db.notification.findMany({
      where: {userId},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: take + 1,
      ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
    }),
  ]);
  const page = rows.slice(0, take);
  return {
    items: page.map(toItem),
    unreadCount,
    nextCursor: rows.length > take ? page[page.length - 1]?.id ?? null : null,
  };
}

/** 标记单条已读。别人的通知一律 404，不泄露存在性；重复标记保留首次已读时间。 */
export async function markNotificationRead(userId: string, id: string): Promise<{unreadCount: number}> {
  if (!ID_PATTERN.test(id)) throw new NotificationError(404, 'NOT_FOUND', '通知不存在。');
  const owned = await db.notification.findFirst({where: {id, userId}, select: {id: true}});
  if (!owned) throw new NotificationError(404, 'NOT_FOUND', '通知不存在。');
  await db.notification.updateMany({where: {id, userId, readAt: null}, data: {readAt: new Date()}});
  return {unreadCount: await countUnread(userId)};
}

export async function markAllNotificationsRead(userId: string): Promise<{unreadCount: number}> {
  await db.notification.updateMany({where: {userId, readAt: null}, data: {readAt: new Date()}});
  return {unreadCount: await countUnread(userId)};
}
