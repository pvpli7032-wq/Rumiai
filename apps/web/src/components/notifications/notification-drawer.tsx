'use client';

import Link from 'next/link';
import {BadgeCheck, BellOff, Coins, MessageSquare, Trophy, type LucideIcon} from 'lucide-react';
import {Button, EmptyState, ErrorState, Sheet, SkeletonText} from '@rumiai/ui';
import {notificationTypeLabel, type NotificationItem} from '@rumiai/contracts/notifications/types';
import {replyExcerpt} from '@rumiai/contracts/notifications/reply-excerpt';
import type {NotificationState} from './use-notifications';

const TYPE_ICONS: Record<string, LucideIcon> = {
  REVIEW_RESULT: BadgeCheck,
  REPLY: MessageSquare,
  COIN_RECEIVED: Coins,
  ACTIVITY_RESULT: Trophy,
};

/** 回复提醒正文由服务端压缩到两行以内；历史行可能更长，显示时再兜一次。 */
function rowBody(item: NotificationItem): string | null {
  if (!item.body) return null;
  return item.type === 'REPLY' ? replyExcerpt(item.body) : item.body;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}

/** 一条通知：未读带红点，有目标对象时整行可点，点之前先标已读。 */
function NotificationRow({item, onRead}: {item: NotificationItem; onRead: (id: string) => void}) {
  const Icon = TYPE_ICONS[item.type] ?? BellOff;
  const unread = !item.readAt;
  const className =
    'flex w-full gap-3 rounded-xl border border-transparent p-3 text-left transition-colors hover:border-border hover:bg-muted/50' +
    (unread ? ' bg-muted/40' : '');
  const content = (
    <>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          {unread && <span aria-label="未读" className="h-2 w-2 shrink-0 rounded-full bg-destructive" />}
        </span>
        {rowBody(item) && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{rowBody(item)}</span>}
        <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{notificationTypeLabel(item.type)}</span>
          <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
        </span>
      </span>
    </>
  );

  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          className={className}
          onClick={() => {
            if (unread) onRead(item.id);
          }}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

export interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: NotificationState;
}

/** 顶栏通知抽屉：列表、翻页、全部已读。 */
export function NotificationDrawer({open, onClose, notifications}: NotificationDrawerProps) {
  const {items, unreadCount, loading, error, actionBusy, hasMore, refresh, loadMore, markRead, markAllRead} = notifications;
  const firstLoad = loading && items.length === 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="通知"
      description={unreadCount > 0 ? unreadCount + ' 条未读' : '全部已读'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            刷新
          </Button>
          <Button variant="secondary" size="sm" disabled={unreadCount === 0 || actionBusy} loading={actionBusy} onClick={() => void markAllRead()}>
            全部标记已读
          </Button>
        </>
      }
    >
      {error && items.length === 0 ? (
        <ErrorState
          title="通知加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              重试
            </Button>
          }
        />
      ) : firstLoad ? (
        <SkeletonText lines={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BellOff className="h-6 w-6" />}
          title="暂时没有通知"
          description="审核结果、回复提醒、到账和活动结果都会出现在这里。"
        />
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {items.map(item => (
              <NotificationRow key={item.id} item={item} onRead={id => void markRead(id)} />
            ))}
          </ul>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" loading={loading} onClick={() => void loadMore()}>
                加载更多
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
