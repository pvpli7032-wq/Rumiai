'use client';
import { zhText } from '@/lib/zh-text';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  Archive, ChevronRight, Code, Compass, Facebook, Link2,
  MessageSquare, Moon, Plus, Search, Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSiteContent } from '@/lib/use-site-content';
import { CHAT_LIST_CHANGED } from '@/lib/conversations/chat-events';

interface ChatItem {
  id: string;
  title: string;
  avatarUrl?: string | null;
}

/** Desktop-only left sidebar: brand, promo banner, coin balance, quick actions, chat list. */
export function Sidebar() {
  const { user, token } = useAuth();
  const { theme, setTheme } = useTheme();
  const { banners } = useSiteContent();
  const [banner, setBanner] = useState(0);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'private' | 'universe'>('private');
  const [chats, setChats] = useState<ChatItem[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    if (banners.sidebar.length < 2) return;
    const t = setInterval(() => setBanner((b) => (b + 1) % banners.sidebar.length), 5000);
    return () => clearInterval(t);
  }, [banners.sidebar.length]);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function onChanged() { setRefreshKey((k) => k + 1); }
    window.addEventListener(CHAT_LIST_CHANGED, onChanged);
    return () => window.removeEventListener(CHAT_LIST_CHANGED, onChanged);
  }, []);

  useEffect(() => {
    if (!user || !token) { setChats([]); return; }
    // Auth is Bearer-only, so without this header the request 401s and the list silently
    // renders "ยังไม่มีแชท" for someone who has a dozen conversations.
    // Re-fetching on pathname keeps a newly started chat from missing until a reload.
    fetch('/api/conversations', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!Array.isArray(data)) return;
        setChats(
          data.map((c: any) => ({
            id: c.id,
            title: c.character?.name ?? c.title ?? zhText("แชท"),
            avatarUrl: c.character?.avatarUrl ?? null,
          })),
        );
      })
      .catch(() => {});
  }, [user, token, pathname, refreshKey]);

  const visible = chats.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  const active = banners.sidebar[banner];

  return (
    <aside className="sticky top-0 hidden h-screen w-64 min-w-64 max-w-64 flex-col border-r bg-background desktop:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 p-4">
        <Link href="/" className="font-athiti text-xl font-bold">
          <span className="bg-linear-to-r/srgb from-[#EE4036] to-[#FAAF40] bg-clip-text text-transparent">{zhText("Khui AI")}</span>
        </Link>
        <button className="ml-auto flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs shadow-xs transition-colors hover:bg-accent">
          <Code className="h-3 w-3" />
          <span className="font-athiti font-medium">{zhText("กรอกโค้ด")}</span>
        </button>
      </div>

      <div className="flex w-full flex-grow flex-col space-y-3 overflow-auto px-4 py-3">
        {/* Promo banner */}
        {active && (
        <div className="w-full">
          <Link href={active.href}>
            <div className="relative flex min-h-20 w-full items-center justify-between gap-2 overflow-hidden rounded-md bg-[#1e1e1e] p-4 text-left">
              <div
                className="absolute inset-0 opacity-30"
                style={{ background: `linear-gradient(225deg, ${active.gradientFrom} 0%, ${active.gradientTo} 100%)` }}
              />
              <div className="relative flex w-[80%] flex-col items-start gap-1">
                <p className="font-athiti text-sm font-bold text-white">{active.title}</p>
                <p className="max-w-full break-words text-xs text-zinc-300">{active.description}</p>
              </div>
              <ChevronRight className="relative h-6 w-6 text-white" />
            </div>
          </Link>
          <div className="mt-2 flex justify-center gap-1">
            {banners.sidebar.map((b, i) => (
              <button
                key={b.id}
                onClick={() => setBanner(i)}
                aria-label={zhText("ไปที่แบนเนอร์") + (i + 1) + zhText("")}
                className={`h-1 w-1 rounded-full transition-all duration-200 ${
                  i === banner ? 'bg-black dark:bg-white' : 'bg-black/40 dark:bg-white/40'
                }`}
              />
            ))}
          </div>
        </div>
        )}

        {/* Coin balance */}
        <Link href="/shop" className="block">
          <div className="flex h-12 w-full items-center justify-between gap-4 rounded-full bg-white px-4 shadow-sm transition-colors hover:border hover:border-zinc-200 dark:bg-[#F4B208]/10 dark:hover:bg-[#F4B208]/20">
            <div className="flex items-center font-athiti">
              <span className="mr-1">🪙</span>
              <span className="font-bold">{user?.coins ?? 0} {zhText("คอยน์")}</span>
            </div>
            <span className="flex h-7 items-center justify-center rounded-full bg-zinc-900 px-4 font-athiti font-bold text-white dark:bg-white dark:text-black">
              {zhText("เติม")}</span>
          </div>
        </Link>

        <nav aria-label="桌面主导航" className="grid grid-cols-2 gap-2">{[['/discover','发现'],['/chat','聊天'],['/circles','圈子'],['/profile','我的']].map(([href,label])=><Link key={href} href={href} scroll={false} className="flex min-h-11 items-center justify-center rounded-xl bg-muted text-sm">{label}</Link>)}</nav>
        {/* Quick actions */}
        <div className="flex flex-col gap-2">
          <Link href="/discover">
            <button className="flex h-9 w-full items-center justify-center rounded-xs border bg-secondary px-4 text-secondary-foreground shadow-xs transition-colors hover:bg-secondary/80">
              <Compass className="mr-1 h-4 w-4" />
              <span className="font-athiti text-sm font-bold">{zhText("ไปหน้าหลัก")}</span>
            </button>
          </Link>
          <Link href="/creator">
            <button className="flex h-9 w-full items-center justify-center rounded-xs bg-primary px-4 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
              <Plus className="mr-1 h-4 w-4" />
              <span className="font-athiti text-sm font-bold">{zhText("สร้างตัวละคร")}</span>
            </button>
          </Link>
        </div>

        {/* Chat list */}
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-800">
          <div className="flex h-10 w-full border-b border-zinc-200 dark:border-zinc-800">
            {([['private', zhText("แชทส่วนตัว")], ['universe', zhText("จักรวาล (ทดลอง)")]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative h-full w-full font-athiti text-sm font-bold transition-colors duration-200 ${
                  tab === key
                    ? 'text-black before:absolute before:bottom-0 before:left-1/2 before:h-0.5 before:w-1/3 before:-translate-x-1/2 before:bg-black dark:text-white dark:before:bg-white'
                    : 'text-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 px-2 pb-2">
            <div className="my-2 flex h-10 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={zhText("ค้นหาแชท")}
                  className="h-10 w-full rounded-full border border-border bg-transparent pl-8 pr-3 text-sm shadow-xs placeholder:font-athiti placeholder:font-bold focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:border-transparent dark:bg-[#1C1D1F]"
                />
              </div>
              <button
                title={zhText("แชทที่จัดเก็บ")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-xs transition-colors hover:bg-accent dark:border-transparent dark:bg-[#1C1D1F]"
              >
                <Archive className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'private' && visible.length > 0 ? (
                visible.map((c) => (
                  <Link
                    key={c.id}
                    href={`/chat?conversation=${c.id}`}
                    className="my-1 flex w-full items-center gap-2 rounded-md p-1 transition-colors hover:bg-accent"
                  >
                    <span className="mr-1 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br/srgb from-[#EE4036] to-[#FAAF40] text-sm font-bold text-white">
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt={c.title} className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        c.title.slice(0, 1)
                      )}
                    </span>
                    <span className="truncate text-sm">{c.title}</span>
                  </Link>
                ))
              ) : (
                <p className="px-1 py-6 text-center font-athiti text-sm text-muted-foreground">
                  {tab === 'private' ? zhText("ยังไม่มีแชท เริ่มคุยกับตัวละครได้เลย") : zhText("เร็ว ๆ นี้")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex min-h-16 flex-row items-center justify-between gap-4 border-t border-gray-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex flex-row items-center gap-1">
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-accent" aria-label="Discord">
            <MessageSquare className="h-4 w-4" />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-accent" aria-label="Facebook">
            <Facebook className="h-4 w-4" />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-accent" aria-label="Linktree">
            <Link2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-accent"
            aria-label={zhText("สลับธีม")}
          >
            <Moon className="block h-4 w-4 dark:hidden" />
            <Sun className="hidden h-4 w-4 dark:block" />
          </button>
        </div>
        <p className="cursor-pointer text-xs text-muted-foreground">{zhText("ข้อกำหนด &amp; ความเป็นส่วนตัว")}</p>
      </div>
    </aside>
  );
}
