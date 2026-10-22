'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {ChevronRight, Sparkles} from 'lucide-react';
import {CharacterCard} from '@/components/character-card';
import {StoryCard} from '@/components/stories/story-card';
import {StoryCatalogCard} from '@/components/stories/story-catalog-card';
import {RankingsTab} from '@/components/rankings-tab';
import {CreatorTab} from '@/components/creator-tab';
import {UniverseTab} from '@/components/universe-tab';
import {
  RAIL, RAIL_ITEM, SectionHeader, FilterRow, HeroBanner, CategoryPills, SearchRow,
} from './discover-parts';
import {useDiscoverData, type ApiCharacter} from './use-discover-data';

export default function DiscoverPage() {
  const {
    banners, sections, token, mirrorEnabled, stories, following, popular,
    query, setQuery, loading, loadError, types, setTypes, roles, setRoles,
    typeFilters, roleFilters, labelsFor, recommended, hot, newest, filtering,
    sceneCharacters, filtered, railItems, toggle,
  } = useDiscoverData();
  const [category, setCategory] = useState("角色");
  const [banner, setBanner] = useState(0);

  useEffect(() => {
    if (banners.hero.length < 2) return;
    const timer = setInterval(() => setBanner((b) => (b + 1) % banners.hero.length), 5000);
    return () => clearInterval(timer);
  }, [banners.hero.length]);

  const card = (c: ApiCharacter, index: number) => (
    <CharacterCard key={c.id} character={{ ...c, tagLabels: labelsFor(c) }} index={index} />
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HeroBanner banners={banners.hero} banner={banner} onSelect={setBanner} />

      <CategoryPills category={category} onSelect={setCategory} />

      {category === "榜单" ? (
        <RankingsTab />
      ) : category === "世界观" ? (
        <UniverseTab />
      ) : category === "创作者" ? (
        <CreatorTab />
      ) : (
        <>
          <SearchRow
            query={query}
            onQueryChange={setQuery}
            onRandom={() => {
              if (!popular.length) return;
              setQuery(popular[Math.floor(Math.random() * popular.length)].name);
            }}
          />

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

          {!filtering && stories.length > 0 && (
            <section className="mt-6 space-y-3 px-4 md:px-12">
              <div>
                <h2 className="text-base font-bold md:text-lg">故事体验</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">有固定章节与持续记忆的长故事</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 desktop:grid-cols-3">
                {stories.map((story) => (
                  <StoryCatalogCard key={story.slug} story={story} />
                ))}
              </div>
            </section>
          )}

          {/* 他眼中的你（V3 §23）：独立玩法入口，开关关掉时不渲染 */}
          {!filtering && mirrorEnabled && (
            <section className="mt-6 space-y-3 px-4 md:px-12">
              <SectionHeader emoji="🪞" title="他眼中的你" hint="选一个角色，回答几道短问题，看看 TA 眼中的你是什么样子" />
              <Link
                href="/mirror"
                className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:border-brand/60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient">
                  <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">进入「他眼中的你」</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">结果由 AI 生成，可以分享给朋友</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                  去看看
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
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
