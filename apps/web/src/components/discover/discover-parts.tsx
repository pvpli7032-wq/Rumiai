'use client';

import Link from 'next/link';
import {ChevronRight, Search, Sparkles, Tag, Users, Play} from 'lucide-react';
import { DesignIcon } from '@/components/primitives/design-icon';
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
                active ? 'bg-brand-gradient text-white' : 'border border-border text-foreground dark:border-border'
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
              active ? 'text-white' : 'border border-border text-foreground dark:border-border'
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
  onSearch,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRandom: () => void;
  onSearch: () => void;
}) {
  return <form role="search" onSubmit={event => { event.preventDefault(); onSearch(); }} className="flex w-full items-center gap-2">
    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-4"><DesignIcon name="ph:magnifying-glass" className="h-5 w-5 shrink-0 text-muted-foreground"/><input type="search" enterKeyHint="search" aria-label="搜索角色" placeholder="搜索角色" value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 w-full bg-transparent py-2.5 text-sm outline-none"/></label>
    <button type="button" aria-label="随机探索角色" onClick={onRandom} className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-card text-primary active:bg-muted"><DesignIcon name="ph:arrows-clockwise"/></button>
  </form>;
}
