'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';
import { useSiteContent } from '@web/lib/use-site-content';
import { DesignIcon } from '@/components/primitives/design-icon';
import { NotificationBell } from '@/components/notifications/notification-bell';

const MOBILE_HEADERS: Record<string, { title: string; subtitle?: string }> = {
  '/chat': { title: '聊天', subtitle: '接着上次的故事，慢慢聊。' },
  '/creator': { title: '创作', subtitle: '让想象力，遇见更多人' },
  '/square': { title: '广场', subtitle: '和同好一起，聊喜欢的世界。' },
  '/profile': { title: '我的' },
};

/** Mobile primary routes use one page title while retaining global account actions. */
export function Topbar() {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { branding } = useSiteContent();
  const header = pathname === '/discover'
    ? { title: branding.brandName, subtitle: '找到聊得来的世界' }
    : MOBILE_HEADERS[pathname];

  return (
    <div className={`sticky top-0 z-30 border-b border-transparent bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 ${pathname === '/chat' ? 'desktop:hidden' : ''}`}>
      <div className="flex min-h-16 w-full items-center gap-3 px-4 py-3">
        {header ? (
          <div className="min-w-0 desktop:hidden">
            <h1 className="flex items-center gap-2 text-[28px] font-bold leading-tight tracking-tight text-foreground"><span className="truncate">{header.title}</span>{pathname !== '/profile' && <DesignIcon name="ph:sparkle-fill" size={18} className="shrink-0" style={{ color: 'var(--color-warm-orange)' }} />}</h1>
            {header.subtitle ? <p className="truncate text-sm text-muted-foreground">{header.subtitle}</p> : null}
          </div>
        ) : (
          <Link href="/" className="text-xl font-bold desktop:hidden">
            <span className="bg-linear-to-r from-brand to-brand-2 bg-clip-text text-transparent">{branding.brandName}</span>
          </Link>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link href="/shop" className="web-control hidden h-9 desktop:flex items-center rounded-full border border-border bg-card px-3 shadow-sm transition-colors hover:bg-accent">
            <span className="mr-1">🪙</span>
            <span className="font-bold">{user?.coins ?? 0}</span>
          </Link>
          <NotificationBell />
          {!isLoading && (user ? (
            <Link href="/profile" aria-label="个人资料">
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-brand text-sm font-bold text-brand-foreground">
                {user.avatarUrl ? <img src={user.avatarUrl} alt={user.username} className="h-full w-full object-cover" draggable={false} /> : user.username[0]?.toUpperCase()}
              </span>
            </Link>
          ) : (
            <Link href="/login" className="flex h-9 items-center rounded-full bg-brand px-3 text-sm font-bold text-brand-foreground">登录</Link>
          ))}
        </div>
      </div>
    </div>
  );
}