'use client';

import {useState} from 'react';
import {Bell} from 'lucide-react';
import {useAuth} from '@web/lib/auth-context';
import {NotificationDrawer} from './notification-drawer';
import {useNotifications} from './use-notifications';

/**
 * 顶栏通知入口。红点与抽屉列表共用同一个未读计数，点开即刷新一次，
 * 不做轮询与推送：V3 只要求站内，不要邮件轰炸。
 */
export function NotificationBell() {
  const {token, user} = useAuth();
  const [open, setOpen] = useState(false);
  const notifications = useNotifications(token);
  if (!user) return null;
  const {unreadCount, refresh} = notifications;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
        aria-label={unreadCount > 0 ? '通知，' + unreadCount + ' 条未读' : '通知'}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-foreground shadow-sm transition-colors hover:border hover:border-zinc-200 dark:bg-brand-2/10 dark:hover:bg-brand-2/20"
      >
        <Bell aria-hidden className="h-4 w-4" />
        {unreadCount > 0 && (
          <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
        )}
      </button>
      <NotificationDrawer open={open} onClose={() => setOpen(false)} notifications={notifications} />
    </>
  );
}
