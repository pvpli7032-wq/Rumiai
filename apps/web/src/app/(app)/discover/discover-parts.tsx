'use client';

import Link from 'next/link';
import {ChevronRight, Search, Sparkles, Tag, Users, Play} from 'lucide-react';
import type {SiteBanner} from '@web/lib/use-site-content';

export const RAIL = 'flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
export const RAIL_ITEM = 'w-32 shrink-0 md:w-40';

export const CATEGORIES = [
  { emoji: '👨🏻‍✈️', label: "角色" },
  { emoji: '🌍', label: "世界观" },
  { emoji: '✍🏻', label: "创作者" },
  { emoji: '🏆', label: "榜单" },
];

/** 分区抬头：emoji + 标题 + 一句说明 + 右侧动作。 */
export function SectionHeader({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-base font-bold md:text-lg">
          <span aria-hidden className="shrink-0 select-none leading-none">{emoji}</span>
          <span className="min-w-0">{title}</span>
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="flex min-h-9 shrink-0 items-center gap-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {action.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => onToggle(o.key)}
              className={`flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-semibold transition-all ${
                active ? 'bg-brand-gradient text-white' : 'border border-zinc-200 text-foreground dark:border-[#2A2A2A]'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HeroBanner({
  banners,
  banner,
  onSelect,
}: {
  banners: SiteBanner[];
  banner: number;
  onSelect: (index: number) => void;
}) {
  const hero = banners[banner];
  if (!hero) return null;
  return (
    <div className="mb-2 mt-3 px-4 md:px-12">
      <Link href={hero.href}>
        <div
          className="relative flex aspect-[375/90] w-full flex-col justify-center overflow-hidden rounded-xl px-6 md:aspect-[1000/120]"
          style={{ backgroundImage: `${hero.imageUrl ? `url("${hero.imageUrl}"), ` : ''}linear-gradient(225deg, ${hero.gradientFrom} 0%, ${hero.gradientTo} 100%)`, backgroundSize: hero.imageUrl ? 'cover' : undefined, backgroundPosition: 'center' }}
        >
          <p className="text-sm font-bold text-white drop-shadow-sm md:text-base">{hero.title}</p>
          <p className="text-xs text-white/90 drop-shadow-sm md:text-sm">{hero.description}</p>
        </div>
      </Link>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {banners.map((b, i) => (
          <button
            key={b.id}
            onClick={() => onSelect(i)}
            aria-label={"切换横幅" + (i + 1)}
            className={`h-1.5 rounded-full transition-all duration-200 ${i === banner ? 'w-4 bg-foreground' : 'w-1.5 bg-foreground/40'}`}
          />
        ))}
      </div>
    </div>
  );
}

export function CategoryPills({category, onSelect}: {category: string; onSelect: (label: string) => void}) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto px-4 pb-0 pt-6 [-ms-overflow-style:none] [scrollbar-width:none] md:overflow-visible md:px-12 [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map((c) => {
        const active = c.label === category;
        return (
          <button
            key={c.label}
            onClick={() => onSelect(c.label)}
            className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all md:flex-none md:px-6 ${
              active ? 'text-white' : 'border border-zinc-200 text-foreground dark:border-[#2A2A2A]'
            }`}
            style={active ? { background: 'linear-gradient(225deg, var(--brand-accent-1) 0%, var(--brand-accent-2) 100%)' } : undefined}
          >
            <span aria-hidden>{c.emoji}</span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SearchRow({
  query,
  onQueryChange,
  onRandom,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRandom: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 md:px-12">
      <button aria-label={"标签"} className="relative flex items-center bg-transparent">
        <Tag className="h-5 w-5 text-muted-foreground" />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      </button>

      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-4 dark:bg-[#27272A]">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="搜索角色"
          placeholder="搜索角色"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full min-w-0 bg-transparent outline-hidden"
        />
      </label>

      <button
        aria-label="随机角色"
        onClick={onRandom}
        className="group relative flex h-12 w-12 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-lg bg-brand-gradient shadow-md transition-all duration-200 hover:scale-105 active:scale-95 md:w-auto md:px-3"
      >
        <span className="relative z-10 text-lg">🎲</span>
        <span className="relative z-10 hidden whitespace-nowrap text-sm font-medium text-white md:inline">浏览角色</span>
      </button>

      <div className="hidden shrink-0 desktop:block">
        <div className="flex h-12 items-center gap-2 rounded-lg bg-zinc-100 px-3 dark:bg-[#27272A]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br/srgb from-[#A855F7] to-[#EC4899]">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current text-white" />
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br/srgb from-[#8B5CF6] to-[#6366F1]">
            <Users className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
      </div>
    </div>
  );
}
