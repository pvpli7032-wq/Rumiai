'use client';

import Link from 'next/link';
import { useAuth } from '@web/lib/auth-context';
import { useSiteContent } from '@web/lib/use-site-content';
import { NotificationBell } from '@/components/notifications/notification-bell';

/** Sticky top bar shown above the main column (brand on mobile, coins + account always). */
export function Topbar() {
  const { user, isLoading } = useAuth();
  const { branding } = useSiteContent();

  return (
    <div className="sticky top-0 z-50 border-b border-transparent bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-16 w-full items-center gap-2 p-4">
        <Link href="/" className="text-xl font-bold desktop:hidden">
          <span className="bg-linear-to-r from-brand to-brand-2 bg-clip-text text-transparent">{branding.brandName}</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/shop"
            className="flex h-9 items-center rounded-full bg-white px-4 shadow-sm transition-colors hover:border hover:border-zinc-200 dark:bg-brand-2/10 dark:hover:bg-brand-2/20"
          >
            <span className="mr-1">🪙</span>
            <span className="font-bold">{user?.coins ?? 0}</span>
          </Link>

          <NotificationBell />

          {!isLoading &&
            (user ? (
              <Link href="/profile" aria-label="个人资料">
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-brand-gradient text-sm font-bold text-white dark:border-zinc-800">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.username} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    user.username[0]?.toUpperCase()
                  )}
                </span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="flex h-9 items-center rounded-full bg-brand-gradient px-4 text-sm font-bold text-brand-foreground"
              >
                登录</Link>
            ))}
        </div>
      </div>
    </div>
  );
}
