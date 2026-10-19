'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, Sparkles, Tag, Users, Play } from 'lucide-react';
import { CharacterCard, type CharacterCardData } from '@/components/character-card';
import { StoryCard } from '@/components/stories/story-card';
import { getPublishedSceneConfigs } from '@/lib/stories/scene-service';
import { getSceneConfigByCharacterId } from '@/lib/stories/scene-config';
import { RankingsTab } from '@/components/rankings-tab';
import { CreatorTab } from '@/components/creator-tab';
import { UniverseTab } from '@/components/universe-tab';
import { useSiteContent } from '@/lib/use-site-content';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { API } from '@/lib/api-paths';

const CATEGORIES = [
  { emoji: '👨🏻‍✈️', label: "角色" },
  { emoji: '🌍', label: "世界观" },
  { emoji: '✍🏻', label: "创作者" },
  { emoji: '🏆', label: "榜单" },
];

const RAIL = 'flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const RAIL_ITEM = 'w-32 shrink-0 md:w-40';

interface ApiCharacter extends CharacterCardData {
  createdAt: string;
}

/** 分区抬头：emoji + 标题 + 一句说明 + 右侧动作。 */
function SectionHeader({
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

export default function DiscoverPage() {
  const { banners, tags, sections } = useSiteContent();
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [popular, setPopular] = useState<ApiCharacter[]>([]);
  const [fresh, setFresh] = useState<ApiCharacter[]>([]);
  const [following, setFollowing] = useState<ApiCharacter[]>([]);
  const [category, setCategory] = useState("角色");
  const [banner, setBanner] = useState(0);
  const [types, setTypes] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);

  // 三个分区各自取数：热门按对话数、新角色按创建时间、关注的创作者按关注关系。
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const [hot, latest] = await Promise.all([
          api.get<ApiCharacter[]>(API.characters.list('sort=popular'), { signal: controller.signal }),
          api.get<ApiCharacter[]>(API.characters.list('sort=new'), { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setPopular(Array.isArray(hot) ? hot : []);
        setFresh(Array.isArray(latest) ? latest : []);
      } catch (error) {
        if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
        setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  // 关注的创作者要带令牌；未登录不请求，也不显示该分区。
  useEffect(() => {
    if (!token) {
      setFollowing([]);
      return;
    }
    const controller = new AbortController();
    void api
      .get<ApiCharacter[]>(API.characters.list('scope=following'), { token, signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted && Array.isArray(rows)) setFollowing(rows);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (banners.hero.length < 2) return;
    const timer = setInterval(() => setBanner((b) => (b + 1) % banners.hero.length), 5000);
    return () => clearInterval(timer);
  }, [banners.hero.length]);

  const tagLabels = useMemo(() => new Map(tags.map((t) => [t.key, t.label])), [tags]);
  const typeFilters = useMemo(() => tags.filter((t) => t.filterRow === 'type'), [tags]);
  const roleFilters = useMemo(() => tags.filter((t) => t.filterRow === 'role'), [tags]);

  const labelsFor = (character: ApiCharacter) =>
    (character.tags ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => tagLabels.get(key) ?? key);

  /** 今日推荐：独家优先，其次热门，去重后取 12。 */
  const recommended = useMemo(() => {
    const seen = new Set<string>();
    const picked: ApiCharacter[] = [];
    for (const c of [...popular.filter((c) => c.isExclusive), ...popular]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picked.push(c);
      if (picked.length >= 12) break;
    }
    return picked;
  }, [popular]);

  const hot = useMemo(() => popular.slice(0, 12), [popular]);
  const newest = useMemo(
    () => [...fresh].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 12),
    [fresh],
  );

  const filtering = Boolean(query) || types.length > 0 || roles.length > 0;
  const sceneCharacters = useMemo(() => {
    const pool = new Map<string, ApiCharacter>();
    for (const character of [...popular, ...fresh]) {
      if (getSceneConfigByCharacterId(character.id)) pool.set(character.id, character);
    }
    return getPublishedSceneConfigs().flatMap(scene => {
      const character = pool.get(scene.characterId);
      return character ? [{scene, character}] : [];
    });
  }, [popular, fresh]);

  /** 全部角色：搜索与标签筛选只作用在这一段，不打断上面的分区。 */
  const filtered = useMemo(() => {
    const pool = new Map<string, ApiCharacter>();
    for (const c of [...fresh, ...popular]) pool.set(c.id, c);
    const selected = [...types, ...roles];
    return [...pool.values()]
      .filter((c) => {
        if (query && !`${c.name} ${c.tagline ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (selected.length === 0) return true;
        const own = (c.tags ?? '').split(',');
        return selected.every((t) => own.includes(t));
      })
      .sort((a, b) => b.chatCount - a.chatCount);
  }, [popular, fresh, query, types, roles]);

  /** 后台配置的展示区（site sections）按来源解析成角色列表。 */
  const railItems = (source: string, tagKey: string | null) => {
    const pool = [...popular, ...fresh].filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);
    switch (source) {
      case 'EXCLUSIVE':
        return pool.filter((c) => c.isExclusive).sort((a, b) => b.chatCount - a.chatCount).slice(0, 12);
      case 'POPULAR':
        return [...popular].sort((a, b) => b.chatCount - a.chatCount).slice(0, 12);
      case 'NEWEST':
        return [...pool].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 12);
      case 'TAG':
        return pool.filter((c) => (c.tags ?? '').split(',').includes(tagKey ?? '')).slice(0, 12);
      default:
        return pool.slice(0, 12);
    }
  };

  const hero = banners.hero[banner];
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const card = (c: ApiCharacter, index: number) => (
    <CharacterCard key={c.id} character={{ ...c, tagLabels: labelsFor(c) }} index={index} />
  );

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
                className={`h-1.5 rounded-full transition-all duration-200 ${i === banner ? 'w-4 bg-foreground' : 'w-1.5 bg-foreground/40'}`}
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

            <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-4 dark:bg-[#27272A]">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="搜索角色"
                placeholder="搜索角色"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full min-w-0 bg-transparent outline-hidden"
              />
            </label>

            <button
              aria-label="随机角色"
              onClick={() => {
                if (!popular.length) return;
                setQuery(popular[Math.floor(Math.random() * popular.length)].name);
              }}
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

          {/* 后台配置的展示区，只在未搜索时出现，避免和下面的分区抢位置 */}
          {!filtering && sections.length > 0 && (
            <div className="mt-2 w-full space-y-8">
              {sections.map((s) => {
                const items = railItems(s.source, s.tagKey);
                if (!items.length) return null;
                return (
                  <section key={s.key} className="space-y-3 px-4 md:px-12">
                    <SectionHeader emoji={s.emoji} title={s.title} />
                    <div className={RAIL}>
                      {items.map((c, i) => (
                        <div key={c.id} className={RAIL_ITEM}>{card(c, i)}</div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {!filtering && sceneCharacters.length > 0 && (
            <section className="mt-6 space-y-3 px-4 md:px-12">
              <div>
                <h2 className="text-base font-bold md:text-lg">精选场景</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">从一个具体事件开始</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 desktop:grid-cols-3">
                {sceneCharacters.map(({scene, character}) => (
                  <StoryCard key={scene.id} scene={scene} character={{id: character.id, name: character.name, tagline: character.tagline, avatarUrl: character.avatarUrl}} href={'/chat?character=' + encodeURIComponent(character.id) + '&scene=1'} />
                ))}
              </div>
            </section>
          )}

          {/* 内容流分区：今日推荐 / 热门 / 新角色 / 关注的创作者 / 榜单 */}
          {!filtering && (
            <div className="mt-8 w-full space-y-10">
              <section className="space-y-3 px-4 md:px-12">
                <SectionHeader emoji="✨" title="今日推荐" hint="独家角色与近期热门，按对话数排序" />
                {loading ? (
                  <div role="status" aria-label="正在加载角色" className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-4 xl:grid-cols-6">
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <div key={n} className="h-48 animate-pulse rounded-xl bg-muted" />
                    ))}
                  </div>
                ) : loadError ? (
                  <p role="alert" className="py-6 text-center text-sm">角色加载失败，请刷新重试。</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-4 xl:grid-cols-6">
                    {recommended.slice(0, 6).map((c, i) => card(c, i))}
                  </div>
                )}
              </section>

              {hot.length > 0 && (
                <section className="space-y-3 px-4 md:px-12">
                  <SectionHeader emoji="🔥" title="热门" hint="对话次数最多的角色" />
                  <div className={RAIL}>
                    {hot.map((c, i) => (
                      <div key={c.id} className={RAIL_ITEM}>{card(c, i)}</div>
                    ))}
                  </div>
                </section>
              )}

              {newest.length > 0 && (
                <section className="space-y-3 px-4 md:px-12">
                  <SectionHeader emoji="🌱" title="新角色" hint="刚刚上架，趁早认识" />
                  <div className={RAIL}>
                    {newest.map((c, i) => (
                      <div key={c.id} className={RAIL_ITEM}>{card(c, i)}</div>
                    ))}
                  </div>
                </section>
              )}

              {token && following.length > 0 && (
                <section className="space-y-3 px-4 md:px-12">
                  <SectionHeader emoji="👥" title="关注的创作者" hint="你关注的创作者最近的作品" />
                  <div className={RAIL}>
                    {following.map((c, i) => (
                      <div key={c.id} className={RAIL_ITEM}>{card(c, i)}</div>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-3 px-4 md:px-12">
                <SectionHeader
                  emoji="🏆"
                  title="榜单"
                  hint="本周角色、创作者与礼物榜"
                  action={{ label: "完整榜单", onClick: () => setCategory("榜单") }}
                />
                <RankingsTab />
              </section>
            </div>
          )}

          {/* 全部角色：搜索与筛选只影响这一段 */}
          <div className="mt-10 space-y-3 pb-16">
            <div className="space-y-2 px-4 md:px-12">
              <SectionHeader
                emoji="🧭"
                title={filtering ? "筛选结果" : "全部角色"}
                hint={filtering ? `命中 ${filtered.length} 个角色` : "按类型与角色筛选"}
                action={filtering ? { label: "清除筛选", onClick: () => { setQuery(''); setTypes([]); setRoles([]); } } : undefined}
              />
              <FilterRow label={"类型："} options={typeFilters} selected={types} onToggle={(v) => toggle(types, setTypes, v)} />
              <FilterRow label={"角色："} options={roleFilters} selected={roles} onToggle={(v) => toggle(roles, setRoles, v)} />
            </div>

            {loading && (
              <div role="status" aria-label="正在加载角色" className="grid grid-cols-3 gap-2 px-4 md:grid-cols-4 md:gap-4 md:px-12 xl:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className="h-48 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            )}
            {loadError && <p role="alert" className="p-4 text-center">角色加载失败，请刷新重试。</p>}
            <div className="grid grid-cols-3 gap-2 px-4 pt-1 md:grid-cols-4 md:gap-4 md:px-12 xl:grid-cols-6">
              {filtered.map((c, i) => card(c, i))}
            </div>
            {!loading && !loadError && filtered.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {filtering ? "没有符合条件的角色，换个筛选试试。" : "暂无角色，创建你的第一个角色"}
              </p>
            )}
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
