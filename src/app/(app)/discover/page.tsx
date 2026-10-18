'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Sparkles, Tag, Users, Play } from 'lucide-react';
import { CharacterCard, type CharacterCardData } from '@/components/character-card';
import { CharacterRail } from '@/components/character-rail';
import { RankingsTab } from '@/components/rankings-tab';
import { CreatorTab } from '@/components/creator-tab';
import { UniverseTab } from '@/components/universe-tab';
import { useSiteContent } from '@/lib/use-site-content';

const CATEGORIES = [
  { emoji: '👨🏻‍✈️', label: "角色" },
  { emoji: '🌍', label: "世界观" },
  { emoji: '✍🏻', label: "创作者" },
  { emoji: '🏆', label: "榜单" },
];

const TABS = [
  { emoji: '🌱', label: "最新", key: 'new' },
  { emoji: '🔥', label: "热门趋势", key: 'trending' },
  { emoji: '🏆', label: "热门", key: 'popular' },
  { emoji: '👥', label: "关注的创作者", key: 'following' },
] as const;

interface ApiCharacter extends CharacterCardData {
  createdAt: string;
}

export default function HomePage() {
  const { banners, tags, sections } = useSiteContent();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [characters, setCharacters] = useState<ApiCharacter[]>([]);
  const [category, setCategory] = useState("角色");
  const [banner, setBanner] = useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('new');
  const [types, setTypes] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);setLoadError(false);
    const timer = setTimeout(() => {
      fetch('/api/characters?' + new URLSearchParams([['search',query],['sort',tab==='new'?'new':'popular'],...[...types,...roles].map(tag=>['tag',tag])]).toString(), { signal: controller.signal })
        .then(r => { if (!r.ok) throw Error(); return r.json(); })
        .then(data => { if (!controller.signal.aborted && Array.isArray(data)) setCharacters(data); })
        .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer);controller.abort(); };
  }, [query, tab, types, roles]);

  useEffect(() => {
    if (banners.hero.length < 2) return;
    const t = setInterval(() => setBanner((b) => (b + 1) % banners.hero.length), 5000);
    return () => clearInterval(t);
  }, [banners.hero.length]);

  // Filter chip rows and their labels both come from the tag table.
  const typeFilters = useMemo(() => tags.filter((t) => t.filterRow === 'type'), [tags]);
  const roleFilters = useMemo(() => tags.filter((t) => t.filterRow === 'role'), [tags]);

  /** Resolves a rail's configured source into the characters it should show. */
  const railItems = (source: string, tagKey: string | null) => {
    switch (source) {
      case 'EXCLUSIVE':
        return characters.filter((c) => c.isExclusive).sort((a, b) => b.chatCount - a.chatCount).slice(0, 12);
      case 'POPULAR':
        return [...characters].sort((a, b) => b.chatCount - a.chatCount).slice(0, 12);
      case 'NEWEST':
        return [...characters].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 12);
      case 'TAG':
        return characters.filter((c) => (c.tags ?? '').split(',').includes(tagKey ?? '')).slice(0, 12);
      default:
        return characters.slice(0, 12);
    }
  };

  const grid = useMemo(() => {
    const selected = [...types, ...roles];
    const list = characters.filter((c) => {
      if(query && !(c.name+' '+(c.tagline||'')).toLowerCase().includes(query.toLowerCase()))return false;
      if (selected.length === 0) return true;
      const own = (c.tags ?? '').split(',');
      return selected.every((t) => own.includes(t));
    });
    if (tab === 'new') list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    else list.sort((a, b) => b.chatCount - a.chatCount);
    return list;
  }, [characters, tab, types, roles, query]);

  const hero = banners.hero[banner];

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero banner carousel */}
      {hero && (
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
          {banners.hero.map((b, i) => (
            <button
              key={b.id}
              onClick={() => setBanner(i)}
              aria-label={"切换横幅" + (i + 1)}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === banner ? 'w-4 bg-foreground' : 'w-1.5 bg-foreground/40'
              }`}
            />
          ))}
        </div>
      </div>
      )}

      {/* Category pills */}
      <div className="flex items-center gap-3 overflow-x-auto px-4 pb-0 pt-6 [-ms-overflow-style:none] [scrollbar-width:none] md:overflow-visible md:px-12 [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => {
          const active = c.label === category;
          return (
            <button
              key={c.label}
              onClick={() => setCategory(c.label)}
              className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all md:flex-none md:px-6 ${
                active
                  ? 'text-white'
                  : 'border border-zinc-200 text-foreground dark:border-[#2A2A2A]'
              }`}
              style={active ? { background: 'linear-gradient(225deg, #FFA202 0%, #FF1300 100%)' } : undefined}
            >
              <span aria-hidden>{c.emoji}</span>
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      {category === "榜单" ? (
        <RankingsTab />
      ) : category === "世界观" ? (
        <UniverseTab />
      ) : category === "创作者" ? (
        <CreatorTab />
      ) : (
      <>
      {/* Search row */}
      <div className="flex items-center gap-3 px-4 py-2 md:px-12">
        <button aria-label={"标签"} className="relative flex items-center bg-transparent">
          <Tag className="h-5 w-5 text-muted-foreground" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
        </button>

        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-4 dark:bg-[#27272A]"><Search className="h-4 w-4 shrink-0 text-muted-foreground"/><input aria-label="搜索角色" placeholder="搜索角色" value={query} onChange={e=>setQuery(e.target.value)} className="w-full min-w-0 bg-transparent outline-hidden"/></label>

        <button
          aria-label="随机角色" onClick={() => { if(characters.length) setQuery(characters[Math.floor(Math.random()*characters.length)].name); }}
          className="group relative flex h-12 w-12 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-lg bg-brand-gradient shadow-md transition-all duration-200 hover:scale-105 active:scale-95 md:w-auto md:px-3"
        >
          <span className="relative z-10 text-lg">🎲</span>
          <span className="relative z-10 hidden whitespace-nowrap text-sm font-medium text-white md:inline">
            {"浏览角色"}</span>
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

      {/* Rails */}
      <div className="mt-2 w-full space-y-8">
        {(query ? [] : sections).map((s) => (
          <CharacterRail key={s.key} emoji={s.emoji} title={s.title} characters={railItems(s.source, s.tagKey)} />
        ))}

        {/* Tabs + filters + grid */}
        <div className="space-y-3">
          <div className="sticky top-16 z-30 space-y-2 bg-background pb-2 pt-2">
            <div className="flex items-center overflow-x-auto border-b border-zinc-200 [-ms-overflow-style:none] [scrollbar-width:none] dark:border-[#2A2A2A] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`-mb-px flex h-[52px] shrink-0 items-center justify-center gap-1 border-b-2 px-4 text-sm font-semibold transition-all ${
                      active ? 'border-[#F2572B] text-[#F2572B]' : 'border-transparent text-[#8A8A8A]'
                    }`}
                  >
                    <span aria-hidden>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            <FilterRow label={"类型："} options={typeFilters} selected={types} onToggle={(v) => toggle(types, setTypes, v)} />
            <FilterRow label={"角色："} options={roleFilters} selected={roles} onToggle={(v) => toggle(roles, setRoles, v)} />
          </div>

          {loading && <div role="status" aria-label="正在加载角色" className="grid grid-cols-3 gap-2 px-4">{[0,1,2,3,4,5].map(n=><div key={n} className="h-48 animate-pulse rounded-xl bg-muted"/>)}</div>}
          {loadError && <p role="alert" className="p-4 text-center">角色加载失败，请刷新重试。</p>}
          <div className="grid grid-cols-3 gap-2 px-4 pt-1 md:grid-cols-4 md:gap-4 md:px-12 xl:grid-cols-6">
            {grid.map((c, i) => (
              <CharacterCard key={c.id} character={c} index={i} />
            ))}
          </div>

          {!loading && !loadError && grid.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {"暂无角色，创建你的第一个角色"}<code className="rounded-sm bg-muted px-1">npm run db:seed</code>
            </p>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function FilterRow({
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
  return (
    <div className="flex items-center gap-2 px-4 md:px-12">
      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => onToggle(o.key)}
              className={`flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-semibold transition-all ${
                active
                  ? 'bg-brand-gradient text-white'
                  : 'border border-zinc-200 text-foreground dark:border-[#2A2A2A]'
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
