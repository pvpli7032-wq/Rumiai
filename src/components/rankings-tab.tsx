'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, User } from 'lucide-react';
import {compactNumber} from '@/lib/i18n/format';

interface RankedCharacter {
  rank: number; id: string; name: string; avatarUrl: string | null; chatCount: number; isNew: boolean;
}
interface RankedCreator {
  rank: number; id: string | null; username: string; avatarUrl: string | null;
  tier: string; characterCount: number; totalChats: number;
}
interface GiftedCharacter {
  rank: number; id: string; name: string; avatarUrl: string | null; giftCount: number; giftAmount: number;
}
interface NewCreator { id: string; username: string; avatarUrl: string | null }

interface Rankings {
  weekLabel: string;
  characters: RankedCharacter[];
  creators: RankedCreator[];
  topGifted: GiftedCharacter[];
  newCreators: NewCreator[];
}

/** 604100 -> "604.1K" */
/** Medal colours for the creator card ribbons. */
const RIBBON = ['var(--brand-accent-1)', '#A8B0B8', '#B56800'];

export function RankingsTab() {
  const [data, setData] = useState<Rankings | null>(null);

  useEffect(() => {
    fetch('/api/rankings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && !d.error && setData(d))
      .catch(() => {});
  }, []);

  if (!data) {
    return <p className="px-4 py-16 text-center text-sm text-muted-foreground md:px-12">{"正在加载榜单…"}</p>;
  }

  return (
    <div className="w-full px-4 pb-20 md:px-12">
      {/* Week ribbon */}
      <div className="relative mb-4 flex h-[46px] items-center">
        <svg width="46" height="46" viewBox="0 0 46 46" fill="none" className="absolute left-0 top-0 z-10 shrink-0">
          <path
            d="M18.35 2.87C20.27-.96 25.73-.96 27.65 2.87c1.16 2.31 3.84 3.42 6.29 2.6 4.07-1.35 7.93 2.51 6.58 6.58-.81 2.45.3 5.13 2.61 6.29 3.83 1.92 3.83 7.39 0 9.31-2.31 1.16-3.42 3.84-2.61 6.29 1.35 4.07-2.51 7.93-6.58 6.58-2.45-.81-5.13.3-6.29 2.61-1.92 3.83-7.38 3.83-9.3 0-1.16-2.31-3.84-3.42-6.29-2.61-4.07 1.35-7.93-2.51-6.58-6.58.81-2.45-.3-5.13-2.61-6.29-3.83-1.92-3.83-7.39 0-9.31 2.31-1.16 3.42-3.84 2.61-6.29-1.35-4.07 2.51-7.93 6.58-6.58 2.45.82 5.13-.29 6.29-2.6Z"
            fill="url(#rank-star)"
          />
          <defs>
            <linearGradient id="rank-star" x1="6.2" y1="0.6" x2="37" y2="46.8" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFD54F" />
              <stop offset="1" stopColor="#FF6D00" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute left-[7px] top-[4px] z-20 flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-[#F1DD80] bg-linear-to-r/srgb from-[#FF3B01] to-[#FE9002] shadow-[4px_0_4px_rgba(0,0,0,0.25)]">
          <span className="text-lg text-white">#</span>
        </div>
        <div className="absolute left-[22px] right-0 top-[8px] h-[29px] rounded-r-[9px] bg-linear-to-r/srgb from-orange-100 via-amber-50 to-orange-200/80 dark:from-[rgba(255,162,2,0.5)] dark:via-[rgba(255,90,0,0.45)] dark:to-[rgba(255,19,0,0.5)]" />
        <span className="absolute left-[51px] right-2 top-[13px] truncate text-center text-sm font-semibold leading-5">
          {"上周榜单日期："}{data.weekLabel}
        </span>
      </div>

      <div className="space-y-6">
        {/* Characters */}
        <section className="flex flex-col gap-3">
          <Header title={"🚀 本周热门角色"} href="/leaderboard" />
          <div className="-mx-4 flex items-center gap-4 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {data.characters.map((c) => (
              <Link key={c.id} href={`/chat?character=${c.id}`} className="flex shrink-0 items-start">
                <div className={`relative -ml-2 h-[5rem] shrink-0 ${c.rank === 10 ? 'w-[4.5rem]' : 'w-12'}`}>
                  <span
                    className={`absolute left-[0.5625rem] top-1/2 -translate-y-1/2 font-semibold leading-[5rem] text-foreground ${
                      c.rank === 10 ? 'text-[4rem] tracking-[0.03em]' : 'text-[5rem]'
                    }`}
                    style={{
                      WebkitTextStroke: c.rank === 10 ? undefined : '1px hsl(var(--foreground))',
                      maskImage:
                        'linear-gradient(to right, black 0%, black 42%, rgba(0,0,0,0.8) 65%, rgba(0,0,0,0.35) 82%, transparent 100%)',
                    }}
                  >
                    {c.rank}
                  </span>
                </div>
                <div className="z-10 -ml-1 flex flex-col gap-2">
                  <div className="h-[133px] w-[100px] shrink-0 overflow-hidden rounded-2xl border border-border bg-[#1A1A2E] md:h-[186px] md:w-[140px]">
                    {c.avatarUrl && <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="max-w-[100px] truncate text-sm font-semibold leading-5 md:max-w-[140px] md:text-base">
                      {c.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground md:text-sm">💬 {compactNumber(c.chatCount)}</span>
                      {c.isNew && (
                        <span className="rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{"新"}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* New creators marquee */}
        {data.newCreators.length > 0 && (
          <section className="flex flex-col gap-3">
            <Header title={"🎨 欢迎新创作者"} />
            <div className="-mx-4 flex flex-wrap gap-3 px-4">
              {data.newCreators.map((u) => (
                <div key={u.id} className="flex w-fit items-center gap-2 rounded-[43px] bg-muted py-1 pl-1 pr-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient text-xs font-bold text-white">
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" /> : u.username.slice(0, 1)}
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold leading-5">@{u.username}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Creators */}
        {data.creators.length > 0 && (
          <section className="flex flex-col gap-3">
            <Header title={"🍾 本周热门创作者"} href="/leaderboard" />
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {data.creators.map((c) => (
                <div
                  key={c.id ?? c.rank}
                  className="flex h-[220px] w-[130px] shrink-0 flex-col items-center gap-2 md:h-[268px] md:w-[164px]"
                >
                  <div className="flex h-[175px] w-full flex-col items-center gap-3 overflow-hidden rounded-2xl bg-card px-3 pb-3 pt-[1px] md:h-[212px]">
                    <div className="relative h-[29px] w-[26px] shrink-0 self-start md:h-[33px] md:w-[30px]">
                      <svg width="26" height="28" viewBox="0 0 26 28" fill="none">
                        <path d="M0 28V0H26V28L13 22.8L0 28Z" fill={RIBBON[c.rank - 1] ?? '#848484'} />
                      </svg>
                      <span className="absolute left-0 top-[4px] w-full text-center text-xs font-semibold leading-4 text-white md:text-sm">
                        {c.rank}
                      </span>
                    </div>
                    <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient text-lg font-bold text-white ring-2 ring-border md:h-[72px] md:w-[72px]">
                      {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" /> : c.username.slice(0, 1)}
                    </span>
                    <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
                      <span className="line-clamp-1 w-full text-center text-sm font-semibold leading-5 md:text-base">
                        @{c.username}
                      </span>
                      <div className="flex items-center gap-1 rounded-[19px] bg-muted px-2 py-[2px]">
                        <User className="h-3 w-3" />
                        <span className="text-[10px] leading-4 md:text-xs">{c.characterCount} {"角色"}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] leading-4 text-muted-foreground md:text-xs">💬 {compactNumber(c.totalChats)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Best of the week */}
        {data.topGifted.length > 0 && (
          <section className="flex flex-col gap-4">
            <span className="text-base font-semibold leading-5">{"⭐ 上周榜单"}</span>
            <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-[240px] shrink-0 flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">{"🎁 收到礼物最多"}</span>
                <div className="flex flex-col gap-1">
                  {data.topGifted.map((g) => (
                    <Link
                      key={g.id}
                      href={`/chat?character=${g.id}`}
                      className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted/50"
                    >
                      <span className="w-5 text-center text-lg font-semibold text-muted-foreground md:w-6 md:text-xl">
                        {g.rank}
                      </span>
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border bg-[#1A1A2E] md:h-[72px] md:w-[72px]">
                        {g.avatarUrl && <img src={g.avatarUrl} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold leading-5 md:text-base">{g.name}</span>
                        <span className="text-xs text-muted-foreground md:text-sm">{g.giftCount} 🎁</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Header({ title, href }: { title: string; href?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base font-semibold leading-5">{title}</span>
      {href && (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted"
        >
          {"查看全部"}<ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}