'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookUser, MessageCircle, Search, Tag } from 'lucide-react';

interface Universe {
  id: string;
  name: string;
  tagline: string | null;
  description: string;
  imageUrl: string | null;
  characterCount: number;
  chatCount: number;
  tags: string | null;
  createdAt: string;
}

const RANGES = ["今天", "本周", "本月", "全部"] as const;
const TABS = [
  { emoji: '🔥', label: "热门趋势", key: 'trending' },
  { emoji: '🌱', label: "最新", key: 'new' },
  { emoji: '🏆', label: "热门", key: 'popular' },
  { emoji: '👥', label: "关注的创作者", key: 'following' },
] as const;

/** 3900 -> "3.9k" */
function compact(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Deterministic cover gradient so a world without artwork still reads as itself. */
const COVERS = [
  'linear-gradient(160deg,#3b1d4d,#141428)',
  'linear-gradient(160deg,#0f2a3d,#0b1220)',
  'linear-gradient(160deg,#3d1f1f,#180f0f)',
  'linear-gradient(160deg,#1c3320,#0d1a10)',
  'linear-gradient(160deg,#33261a,#170f09)',
  'linear-gradient(160deg,#241a3d,#0f0b1c)',
];

export function UniverseTab() {
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('trending');

  useEffect(() => {
    fetch('/api/universes')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) && setUniverses(d))
      .catch(() => {});
  }, []);

  const grid = useMemo(() => {
    const list = universes.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()));
    if (tab === 'new') return [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return [...list].sort((a, b) => b.chatCount - a.chatCount);
  }, [universes, query, tab]);

  const recommended = universes.slice(0, 12);
  const popular = [...universes].sort((a, b) => b.chatCount - a.chatCount).slice(0, 12);

  return (
    <div className="w-full">
      {/* Search row */}
      <div className="flex items-center gap-3 px-4 py-2 md:px-12">
        <button aria-label={"标签"} className="relative flex items-center bg-transparent">
          <Tag className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={"搜索世界观"}
            className="h-12 w-full rounded-lg bg-zinc-100 pl-10 pr-4 text-sm outline-hidden dark:bg-[#27272A]"
          />
        </div>
      </div>

      <div className="mt-2 w-full space-y-6 pb-8">
        <Rail emoji="✨" title={"为你推荐"} items={recommended} />
        <Rail emoji="🔥" title={"热门世界观"} items={popular} />

        {/* Tabs + grid */}
        <div className="space-y-3">
          <div className="flex items-center overflow-x-auto border-b border-zinc-200 [-ms-overflow-style:none] [scrollbar-width:none] dark:border-[#2A2A2A] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex h-[52px] shrink-0 items-center justify-center gap-1 px-4 text-sm font-semibold transition-all ${
                    active ? 'text-[#F2572B]' : 'text-[#8A8A8A]'
                  }`}
                  style={{ borderBottom: `2px solid ${active ? '#F2572B' : 'transparent'}`, marginBottom: -1 }}
                >
                  <span aria-hidden>{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="px-4 pt-1 md:px-12">
            <div className="grid w-full grid-cols-3 gap-2 md:grid-cols-4 md:gap-4 xl:grid-cols-6">
              {grid.map((u, i) => (
                <UniverseCard key={u.id} universe={u} index={i} />
              ))}
            </div>
            {grid.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {"暂无世界观"}<code className="rounded-sm bg-muted px-1">npm run db:seed:universes</code>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Rail({ emoji, title, items }: { emoji: string; title: string; items: Universe[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("本周");
  if (items.length === 0) return null;

  return (
    <div className="space-y-4 px-4 md:px-12">
      <p className="inline-flex items-center gap-1.5 text-base font-bold md:text-lg">
        <span aria-hidden className="shrink-0 select-none leading-none">{emoji}</span>
        <span className="min-w-0">{title}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`h-8 rounded-xl px-3 text-sm transition-all ${
                active ? 'border border-zinc-200 font-bold dark:border-none dark:bg-zinc-800' : 'font-medium text-neutral-500'
              }`}
            >
              <span className={active ? 'bg-brand-gradient bg-clip-text text-transparent' : ''}>
                {r}
              </span>
            </button>
          );
        })}
      </div>

      <div className="w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-[10px]">
          {items.map((u, i) => (
            <div key={u.id} className="w-[140px] shrink-0">
              <UniverseCard universe={u} index={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UniverseCard({ universe, index }: { universe: Universe; index: number }) {
  return (
    <div className="group flex w-full cursor-pointer flex-col transition-all duration-150 ease-out active:scale-[0.98]">
      <div
        className="relative aspect-[160/213] w-full overflow-hidden rounded-2xl bg-[#1A1A2E]"
        style={universe.imageUrl ? undefined : { background: COVERS[index % COVERS.length] }}
      >
        {universe.imageUrl ? (
          <img src={universe.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm font-bold leading-snug text-white/70">
            {universe.name}
          </span>
        )}

        <button type="button" aria-label={"标签"} className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50">
          <Tag className="h-3 w-3 text-white" />
        </button>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5">
            <BookUser className="h-3 w-3 text-white" />
            <span className="text-[10px] font-semibold text-white">{universe.characterCount}</span>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5">
            <MessageCircle className="h-3 w-3 text-white" />
            <span className="text-[10px] font-semibold text-white">{compact(universe.chatCount)}</span>
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 text-sm font-bold md:text-base">{universe.name}</p>
      {universe.tagline && (
        <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-slate-200 md:text-sm">
          {universe.tagline}
        </p>
      )}
    </div>
  );
}
