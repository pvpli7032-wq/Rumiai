'use client';

import { useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';

interface Creator {
  rank: number;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: string;
  followerCount: number;
  characterCount: number;
  messageCount: number;
  chatCount: number;
  universeMessageCount: number;
  universeChatCount: number;
  weeklyFollowerGain: number;
}

const SORTS = [
  { key: 'popularByFollowerCount', label: "关注者最多" },
  { key: 'popularByMessageCount', label: "消息最多" },
  { key: 'popularByChatCount', label: "聊天最多" },
  { key: 'popularByUniverseMessageCount', label: "世界观消息最多" },
  { key: 'popularByUniverseChatCount', label: "世界观聊天最多" },
  { key: 'trendingByFollowerCount', label: "本周热门" },
] as const;

/** 10800 -> "10.8K" */
function compact(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Podium pillar styling per place: [gradient, height, ring, ordinal]. */
const PODIUM = {
  1: { grad: 'from-[#FFF4CF] to-[#FDBB3C]', h: 'h-24 sm:h-36 md:h-52 lg:h-64', ring: 'ring-yellow-400', label: '1', sup: ' st', z: 'z-30' },
  2: { grad: 'from-[#DCDCDC] to-[#939393]', h: 'h-16 sm:h-24 md:h-40 lg:h-52', ring: 'ring-gray-300', label: '2', sup: ' nd', z: 'z-20' },
  3: { grad: 'from-[#E9B286] to-[#A8652F]', h: 'h-12 sm:h-20 md:h-32 lg:h-40', ring: 'ring-orange-400', label: '3', sup: ' rd', z: 'z-10' },
} as const;

export function CreatorTab() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('popularByFollowerCount');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch(`/api/creators?sort=${sort}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) && setCreators(d))
      .catch(() => {});
  }, [sort]);

  const visible = creators.filter(
    (c) => c.username.toLowerCase().includes(query.toLowerCase()) || (c.displayName ?? '').includes(query),
  );
  const [first, second, third] = creators;
  const rest = visible.filter((c) => c.rank > 3);

  return (
    <div className="w-full">
      {/* Search */}
      <div className="flex items-center gap-3 px-4 py-2 md:px-12">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={"搜索创作者"}
            className="h-12 w-full rounded-lg bg-zinc-100 pl-10 pr-4 text-sm outline-hidden dark:bg-[#27272A]"
          />
        </div>
      </div>

      <div className="w-full space-y-3 font-athiti sm:space-y-4 lg:space-y-6">
        {/* Sort tabs */}
        <div className="flex flex-row flex-wrap items-center justify-start gap-2 px-3 sm:px-6 md:px-8 lg:px-12">
          {SORTS.map((s) => {
            const active = s.key === sort;
            return (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`group rounded-xl px-3 py-1.5 font-athiti text-sm transition-all duration-200 ${
                  active ? 'bg-zinc-50 font-bold dark:bg-zinc-800' : 'font-medium text-neutral-500'
                }`}
              >
                <span className={active ? 'text-[#EE4036]' : ''}>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Podium */}
        {first && (
          <div className="px-3 pt-4 sm:px-6 md:px-8 lg:px-12">
            <div className="relative h-[20rem] overflow-visible sm:h-[24rem] md:h-[36rem] lg:h-[40rem]">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12)_0%,rgba(0,0,0,0)_40%)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="h-64 w-64 rounded-full opacity-60 blur-3xl md:h-80 md:w-80 lg:h-96 lg:w-96"
                  style={{ background: 'radial-gradient(closest-side, rgba(250,204,21,0.4), rgba(250,204,21,0.15) 50%, transparent 70%)' }}
                />
              </div>

              <div className="relative flex h-full items-end justify-center">
                {[second, first, third].map((c) =>
                  c ? <Podium key={c.id} creator={c} place={c.rank as 1 | 2 | 3} sort={sort} /> : null,
                )}
              </div>
            </div>
          </div>
        )}

        {/* The rest of the board */}
        <div className="bg-background md:grid md:grid-cols-2 md:gap-4 md:p-4 lg:grid-cols-3">
          {rest.map((c) => (
            <div key={c.id} className="md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-card">
              <div className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-4 transition-colors hover:bg-muted/50 md:border-b-0 md:px-5 md:py-5">
                <div className="-ml-2 flex shrink-0 flex-col items-center gap-2">
                  <div className={`relative h-[5rem] shrink-0 ${c.rank >= 10 ? 'w-[4.5rem]' : 'w-12'}`}>
                    <span
                      className={`absolute left-[0.5625rem] top-1/2 -translate-y-1/2 font-barlow font-semibold text-foreground ${
                        c.rank >= 10 ? 'text-[2.125rem] leading-[2.75rem] tracking-[-0.04em]' : 'text-[5rem] leading-[5rem]'
                      }`}
                      style={{
                        WebkitTextStroke: c.rank >= 10 ? undefined : '1px hsl(var(--foreground))',
                        maskImage:
                          'linear-gradient(to right, black 0%, black 42%, rgba(0,0,0,0.8) 65%, rgba(0,0,0,0.35) 82%, transparent 100%)',
                      }}
                    >
                      {c.rank}
                    </span>
                  </div>
                </div>

                <Avatar creator={c} className="mx-4 h-14 w-14 md:h-16 md:w-16" />

                <div className="flex min-w-0 flex-1 flex-col gap-1 md:gap-2">
                  <span className="truncate font-athiti text-sm font-semibold leading-5 md:text-base">
                    {c.displayName || c.username}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">@{c.username}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                      <Users className="h-3 w-3 shrink-0" />
                      <span className="text-[10px] leading-4">{compact(c.followerCount)} {"关注者"}</span>
                    </div>
                    <span className="whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
                      {c.characterCount} {"角色"}</span>
                    <span className="whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
                      {metricLabel(c, sort)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="col-span-full py-16 text-center font-athiti text-sm text-muted-foreground">
              {"没有找到匹配的创作者：“"}{query}”
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The number the active sort is actually ranking by. */
function metricLabel(c: Creator, sort: string) {
  switch (sort) {
    case 'popularByMessageCount':
      return "💬" + (compact(c.messageCount)) + "消息";
    case 'popularByChatCount':
      return "💬" + (compact(c.chatCount)) + "聊天";
    case 'popularByUniverseMessageCount':
      return "🌍" + (compact(c.universeMessageCount)) + "消息";
    case 'popularByUniverseChatCount':
      return "🌍" + (compact(c.universeChatCount)) + "聊天";
    case 'trendingByFollowerCount':
      return "📈 +" + (compact(c.weeklyFollowerGain)) + "本周";
    default:
      return "💬" + (compact(c.messageCount)) + "消息";
  }
}

function Avatar({ creator, className }: { creator: Creator; className: string }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br/srgb from-[#EE4036] to-[#FAAF40] font-bold text-white ${className}`}>
      {creator.avatarUrl ? (
        <img src={creator.avatarUrl} alt="" className="aspect-square h-full w-full object-cover" draggable={false} />
      ) : (
        (creator.displayName || creator.username).slice(0, 1)
      )}
    </span>
  );
}

function Podium({ creator, place, sort }: { creator: Creator; place: 1 | 2 | 3; sort: string }) {
  const p = PODIUM[place];
  return (
    <div className={`relative flex cursor-pointer flex-col items-center transition-all duration-300 ${p.z}`}>
      {place === 1 && (
        <div className="relative mb-1 scale-90 sm:mb-2 sm:scale-90 md:scale-110 lg:scale-125">
          <div className="absolute -left-2 -top-2 h-2 w-2 animate-ping rounded-full bg-yellow-300 opacity-75" />
          <div className="absolute -right-1 -top-1 h-1 w-1 animate-pulse rounded-full bg-yellow-400" />
          <svg width="36" height="36" viewBox="0 0 24 24" className="drop-shadow-lg">
            <defs>
              <linearGradient id="crownGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffd700" />
                <stop offset="50%" stopColor="#ffed4e" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <path d="M5 16L3 10l5.5 3L12 8l3.5 5L21 10l-2 6H5z" fill="url(#crownGradient)" stroke="#d97706" strokeWidth="0.5" />
            <circle cx="8" cy="12" r="1" fill="#ef4444" />
            <circle cx="12" cy="10" r="1.2" fill="#3b82f6" />
            <circle cx="16" cy="12" r="1" fill="#10b981" />
          </svg>
          <div className="absolute inset-0 -z-10 rounded-full bg-yellow-400/30 blur-md" />
        </div>
      )}

      <Avatar
        creator={creator}
        className={`mb-1 shadow-xl ring-2 sm:mb-1.5 sm:ring-[3px] md:mb-2 ${p.ring} h-12 w-12 sm:h-16 sm:w-16 md:h-24 md:w-24 lg:h-28 lg:w-28`}
      />

      <div className="relative z-50 mb-5 w-full max-w-[70px] text-center sm:mb-4 md:mb-6 md:max-w-[110px] lg:max-w-[130px]">
        <div className="truncate font-athiti text-xs font-bold md:text-base lg:text-lg">
          {creator.displayName || creator.username}
        </div>
        <div className="truncate text-xs text-muted-foreground/80 md:text-sm lg:text-base">@{creator.username}</div>
        <div className="truncate text-[10px] text-muted-foreground md:text-xs">{metricLabel(creator, sort)}</div>
      </div>

      <div className={`relative w-20 overflow-visible bg-linear-to-l/srgb shadow-[0_8px_20px_rgba(0,0,0,0.15)] sm:w-28 md:w-44 lg:w-48 ${p.grad} ${p.h}`}>
        <div className="flex h-full flex-col items-center justify-center">
          <div className="relative z-20 text-center font-athiti font-extrabold text-black">
            <span className={place === 1 ? 'text-lg md:text-xl lg:text-[28px]' : 'text-sm md:text-base lg:text-xl'}>{p.label}</span>
            <span className="text-xs md:text-sm lg:text-base">{p.sup}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
