'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@web/lib/auth-context';
import {
  ChevronRight, Compass, MessageSquare, Plus,
} from 'lucide-react';
import { useSiteContent } from '@web/lib/use-site-content';
import { ThemeToggle } from './theme-toggle';
import { ChatConversationList } from '@/components/chat/chat-conversation-list';
import { isPrimaryNavActive, PRIMARY_NAV } from '@web/lib/navigation';


/** Desktop-only left sidebar: brand, promo banner, coin balance, quick actions, chat list. */
export function Sidebar() {
  const { user } = useAuth();
  const { banners, branding, navigation } = useSiteContent();
  const [banner, setBanner] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    if (banners.sidebar.length < 2) return;
    const t = setInterval(() => setBanner((b) => (b + 1) % banners.sidebar.length), 5000);
    return () => clearInterval(t);
  }, [banners.sidebar.length]);

  const active = banners.sidebar[banner];
  // Real links only: the footer links come from the CMS navigation table.
  const social = navigation.footer.slice(0, 3);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 min-w-64 max-w-64 flex-col border-r bg-background desktop:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 p-4">
        <Link href="/" className="text-xl font-bold">
          <span className="flex items-center gap-2"><span className="bg-clip-text text-transparent" style={{backgroundImage:`linear-gradient(90deg,${branding.accentFrom},${branding.accentTo})`}}>{branding.brandName}</span>{branding.logoUrl&&<img src={branding.logoUrl} alt="" width={24} height={24}/>}</span>
        </Link>
      </div>

      <div className="flex w-full flex-grow flex-col space-y-3 overflow-auto px-4 py-3">
        {/* Promo banner */}
        {active && (
        <div className="w-full">
          <Link href={active.href}>
            <div className="relative flex min-h-20 w-full items-center justify-between gap-2 overflow-hidden rounded-md bg-foreground p-4 text-left">
              {active.imageUrl && <img src={active.imageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
              <div
                className="absolute inset-0 opacity-30"
                style={{ background: `linear-gradient(225deg, ${active.gradientFrom} 0%, ${active.gradientTo} 100%)` }}
              />
              <div className="relative flex w-[80%] flex-col items-start gap-1">
                <p className="text-sm font-bold text-background">{active.title}</p>
                <p className="max-w-full break-words text-xs text-background/80">{active.description}</p>
              </div>
              <ChevronRight className="relative h-6 w-6 text-background" />
            </div>
          </Link>
          <div className="mt-2 flex justify-center gap-1">
            {banners.sidebar.map((b, i) => (
              <button
                key={b.id}
                onClick={() => setBanner(i)}
                aria-label={`前往第 ${i + 1} 个横幅`}
                className={`h-1 w-1 rounded-full transition-all duration-200 ${
                  i === banner ? 'bg-foreground' : 'bg-foreground/40'
                }`}
              />
            ))}
          </div>
        </div>
        )}

        {/* Coin balance */}
        <Link href="/shop" className="block">
          <div className="flex h-12 w-full items-center justify-between gap-4 web-pill rounded-full border border-border bg-card px-4 shadow-sm transition-colors hover:bg-accent">
            <div className="flex items-center">
              <span className="mr-1">🪙</span>
              <span className="font-bold">{user?.coins ?? 0} 金币</span>
            </div>
            <span className="web-pill flex h-7 items-center justify-center rounded-full bg-primary px-4 font-bold text-primary-foreground">
              充值</span>
          </div>
        </Link>

        <nav aria-label="桌面主导航" className="grid grid-cols-2 gap-2">
          {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
            const active = isPrimaryNavActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-muted text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset last:col-span-2 ${active ? 'text-brand' : ''}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        {/* Quick actions */}
        <div className="flex flex-col gap-2">
          <Link
            href="/discover"
            className="web-control flex h-11 w-full items-center justify-center rounded-xs border bg-secondary px-4 text-secondary-foreground shadow-xs transition-colors hover:bg-secondary/80"
          >
            <Compass className="mr-1 h-4 w-4" />
            <span className="text-sm font-bold">去发现页</span>
          </Link>
          <Link
            href="/creator"
            className="web-action web-control flex h-11 w-full items-center justify-center rounded-xs px-4 font-semibold shadow-sm"
          >
            <Plus className="mr-1 h-4 w-4" />
            <span className="text-sm font-bold">创建角色</span>
          </Link>
        </div>

        <ChatConversationList variant="sidebar" />
      </div>

      {/* Footer */}
      <div className="flex min-h-16 flex-row items-center justify-between gap-4 border-t border-border px-4 py-2">
        <div className="flex flex-row items-center gap-1">
          {social.map((item) => (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              className="web-control flex h-11 min-w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
              aria-label={item.label}
              title={item.label}
            >
              <MessageSquare className="h-4 w-4" />
            </a>
          ))}
          <ThemeToggle />
        </div>
        <Link href="/zh/terms-and-policy" className="text-xs text-muted-foreground hover:underline">条款与隐私</Link>
      </div>
    </aside>
  );
}
