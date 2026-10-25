'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, ChevronRight, Scale, Sparkles } from 'lucide-react';
import { CharacterCard } from '@/components/characters/character-card';
import { CharacterVisual } from '@/components/characters/character-visual';
import { StoryCard } from '@/components/stories/story-card';
import { StoryCatalogCard } from '@/components/stories/story-catalog-card';
import { RankingsTab } from '@/components/discover/rankings-tab';
import { CreatorTab } from '@/components/discover/creator-tab';
import { UniverseTab } from '@/components/discover/universe-tab';
import { State } from '@/components/primitives/state';
import { SectionHeader } from '@/components/primitives/section-header';
import { FilterRow, SearchRow } from '@/components/discover/discover-parts';
import { useDiscoverData, type ApiCharacter } from '@/components/discover/use-discover-data';
import { useConversationState } from '@/components/chat/chat-conversation-list';
import { CharacterDetailDialog } from '@/components/characters/character-detail-dialog';
import { DesignIcon } from '@/components/primitives/design-icon';
import { DEFAULT_LOCALE } from '@web/lib/i18n';

import { openDiscoverCharacter, useDiscoverState } from './use-discover-state';
import { useAppBack } from '@/components/layout/navigation-history';

/**
 * Discover is the club foyer: CMS-controlled club hero first, then real characters and
 * genuine product entrances. The specialist catalogue views stay available, but no
 * longer replace the landing hierarchy with an old tab/grid dashboard.
 */
export function DiscoverPage() {
  const data = useDiscoverData();
  const { mode, setMode, batch, setBatch, detailId, detailFallback } = useDiscoverState();
  const closeDetail = useAppBack(detailFallback);
  const conversations = useConversationState();
  const recent = conversations.active[0];
  const {
    banners, sections, token, mirrorEnabled, disputeEnabled, stories, popular, query, setQuery,
    loading, loadError, types, setTypes, roles, setRoles, typeFilters, roleFilters,
    labelsFor, recommended, filtering, sceneCharacters, filtered, railItems, toggle, catalogueLoading, catalogueError, hasMore, loadMore, retryCatalogue,
  } = data;

  const cards = (rows: ApiCharacter[], limit?: number, recommendation = mode === '推荐') => rows.slice(0, limit).map((character, index) => (
    <CharacterCard key={character.id} recommendation={recommendation} character={{ ...character, tagLabels: labelsFor(character) }} index={index} />
  ));
  const retry = <button type="button" onClick={data.retry} className="web-control rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">重试</button>;

  return (
    <main data-discover-page className="min-h-screen bg-background pb-24 text-foreground">
      <div className="mx-auto w-full max-w-[1200px]">
        <header data-discover-header className="px-4 pt-1 md:px-6 md:pt-7">
          <div className="hidden desktop:flex desktop:items-center desktop:justify-between desktop:gap-4">
            <div className="hidden md:block">
              <p className="hidden text-2xl font-semibold tracking-tight md:block md:text-3xl">发现<span className="ml-1 text-primary">✦</span></p>
              <p className="mt-1 hidden text-sm text-muted-foreground md:block">找到聊得来的世界</p>
            </div>
            <SearchRow query={query} onQueryChange={setQuery} onSearch={() => setMode('角色')} onRandom={() => {
              if (!popular.length) return;
              setQuery(popular[Math.floor(Math.random() * popular.length)].name);
              setMode('角色');
            }} />
          </div>
          <div className="desktop:hidden"><SearchRow preferencesOnly query={query} onQueryChange={setQuery} onSearch={() => setMode('角色')} onRandom={() => {}}/></div>
          <div className="relative flex items-start gap-3">
          <nav data-discover-interest-tabs aria-label="发现兴趣分类" className="mt-1 flex min-w-0 flex-1 items-center gap-5 overflow-x-auto text-sm font-semibold [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => { setQuery(''); setTypes([]); setRoles([]); setMode('推荐'); }} className={`relative min-h-11 shrink-0 px-1 transition-colors ${mode === '推荐' && !filtering ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>推荐{mode === '推荐' && !filtering && <span aria-hidden className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--action)]" />}</button>
            {typeFilters.slice(0, 4).map(tag => <button key={tag.key} type="button" onClick={() => { setTypes([tag.key]); setRoles([]); setMode('角色'); }} className={`relative min-h-11 shrink-0 px-1 transition-colors ${types.length === 1 && types[0] === tag.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{tag.label}{types.length === 1 && types[0] === tag.key && <span aria-hidden className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--action)]" />}</button>)}
          </nav>
          <details className="group mt-1 shrink-0"><summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground">更多兴趣 <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" /></summary><div className="absolute right-0 top-full z-20 flex min-w-52 flex-wrap gap-2 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-modal)]">{(['角色','世界观','创作者','榜单'] as const).map(item => <button key={item} type="button" onClick={event => { setMode(item); event.currentTarget.closest('details')?.removeAttribute('open'); }} className="min-h-11 rounded-xl px-3 text-sm hover:bg-muted">{item}</button>)}</div></details>
          </div>
        </header>

        {mode === '世界观' ? <UniverseTab /> : mode === '创作者' ? <CreatorTab /> : mode === '榜单' ? <RankingsTab /> : mode === '角色' ? (
          <CharacterCatalogue {...{ types, setTypes, roles, setRoles, typeFilters, roleFilters, toggle, filtered, cards, retry, filtering, catalogueLoading, catalogueError, hasMore, loadMore, retryCatalogue }} />
        ) : (
          <div className="space-y-6 px-4 pb-4 pt-2 md:px-6">
            <ClubHero banners={banners.hero} characters={recommended} />

            {token && <section className="rounded-[24px] bg-primary/8 p-4">
              <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">现在聊到哪了</h2><Link href="/chat" className="inline-flex min-h-11 items-center text-sm text-primary">更多聊天 <ChevronRight className="h-4 w-4"/></Link></div>
              {conversations.loading ? <p role="status" className="py-3 text-sm text-muted-foreground">正在读取对话…</p> : conversations.error ? <div role="alert" className="text-sm text-muted-foreground">对话暂时无法读取。<button type="button" onClick={conversations.refresh} className="ml-2 min-h-11 text-primary">重试</button></div> : recent ? <Link href={recent.character?.id ? '/chat?character='+encodeURIComponent(recent.character.id)+'&conversation='+encodeURIComponent(recent.id) : '/chat?conversation='+encodeURIComponent(recent.id)} className="mt-2 flex min-w-0 items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-primary">{recent.character?.avatarUrl ? <img src={recent.character.avatarUrl} alt="" className="h-full w-full object-cover"/> : <DesignIcon name="ph:chat-circle-text-fill"/>}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{recent.character?.name || recent.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{recent.title || '继续上一次的对话'}</span></span><span className="shrink-0 rounded-full bg-primary/15 px-3 py-2.5 text-xs font-semibold text-primary">继续聊天</span>
              </Link> : <p className="py-2 text-sm text-muted-foreground">还没有对话，先认识一位角色吧。</p>}
            </section>}

            <div className={`grid gap-3 ${mirrorEnabled && disputeEnabled ? 'grid-cols-2' : ''}`}>
              {disputeEnabled && <Link href={`/${DEFAULT_LOCALE}/disputes`} className="group min-h-[148px] rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--action)]/45">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--action)]/10 text-[var(--color-action-text)]"><Scale className="h-5 w-5" /></span>
                <h2 className="mt-3 text-base font-semibold">评理广场</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">有问题，就来聊聊不同观点。</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-action-text)]">看看不同观点 <ArrowUpRight className="h-4 w-4" /></span>
              </Link>}
              {mirrorEnabled && <Link href={`/${DEFAULT_LOCALE}/mirror`} className="group min-h-[148px] rounded-2xl border border-border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)))] p-4 shadow-[var(--shadow-card)] transition-colors hover:border-primary/45">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
                <h2 className="mt-3 text-base font-semibold">他眼中的你</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">换个角色的视角，认识不一样的自己。</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-action-text)]">开始测试 <ArrowUpRight className="h-4 w-4" /></span>
              </Link>}
            </div>

            <section>
              <SectionHeader title="更多有趣的角色" action={<span className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => setMode('角色')} className="inline-flex min-h-11 items-center text-xs font-medium text-primary">浏览全部</button><button type="button" onClick={() => setBatch(value => value + 1)} disabled={recommended.length < 2} className="web-control inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary disabled:opacity-40"><DesignIcon name="ph:arrows-clockwise" className="h-4 w-4"/>换一批</button></span>} />
              {loading ? <CharacterSkeleton /> : loadError ? <State kind="error" className="mt-4" title="角色加载失败" description="请稍后重试。" action={retry} /> : recommended.length ? <div className="mt-3 flex gap-3 overflow-x-auto pb-2">{cards([...recommended.slice(batch % recommended.length), ...recommended.slice(0, batch % recommended.length)]).map((card,index) => <div key={index} className="w-[140px] shrink-0 sm:w-44">{card}</div>)}</div> : <State kind="empty" className="mt-4" title="暂无角色" description="当前没有可展示的角色。" />}
            </section>

            {!loading && !loadError && sections.length > 0 && <section className="space-y-7">
              {sections.map(section => {
                const rows = railItems(section.key);
                if (!rows.length) return null;
                return <div key={section.key}><SectionHeader title={section.title}  />
                  <div className="mt-4 flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{cards(rows).map((card, index) => <div key={index} className="w-32 shrink-0 sm:w-40">{card}</div>)}</div>
                </div>;
              })}
            </section>}

            {token && (data.following.length > 0 || data.followingError || data.followingLoading) && <section><SectionHeader title="关注的创作者" />{data.followingLoading ? <p role="status" className="mt-3 text-sm text-muted-foreground">正在读取关注角色…</p> : data.followingError ? <State kind="error" title="关注角色读取失败" description={data.followingError} action={retry}/> : data.following.length ? <div className="mt-3 flex gap-3 overflow-x-auto">{cards(data.following,undefined,false).map((card,index)=><div key={index} className="w-36 shrink-0">{card}</div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">关注喜欢的创作者后，可在这里看到公开作品。</p>}</section>}
            {sceneCharacters.length > 0 && <section><SectionHeader title="精选场景" description="从一个具体事件开始" />
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{sceneCharacters.map(({ scene, character }) => <StoryCard key={scene.id} scene={scene} character={character} href={`/chat?character=${encodeURIComponent(character.id)}&scene=1`} />)}</div>
            </section>}
            {(stories.length > 0 || data.storiesLoading || data.storiesError) && <section><SectionHeader title="故事体验" description="有固定章节与持续记忆的长故事" />
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{data.storiesLoading ? <p role="status" className="text-sm text-muted-foreground">正在读取故事…</p> : data.storiesError ? <State kind="error" title="故事目录读取失败" description={data.storiesError} action={retry}/> : stories.map(story => <StoryCatalogCard key={story.slug} story={story} />)}</div>
            </section>}
          </div>
        )}
      </div>
      {detailId && <CharacterDetailDialog key={detailId} characterId={detailId} onClose={closeDetail} />}
    </main>
  );
}

function ClubHero({ banners, characters }: { banners: { id: string; title: string; description: string; href: string; imageUrl?: string | null; gradientFrom: string; gradientTo: string }[]; characters: ApiCharacter[] }) {
  const hero = banners[0];
  return <section data-discover-hero className="grid h-[340px] grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 md:h-[420px]">
    {hero ? <Link data-discover-hero-story href={hero.href} className="relative flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-border bg-muted text-white">
      {hero.imageUrl ? <img src={hero.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Image src="/illustrations/env-arched-courtyard-envelope-v1.png" alt="" fill sizes="(max-width: 640px) 60vw, 50vw" className="object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/15 to-transparent" />
      <div className="relative space-y-3 p-4 md:p-6"><span className="inline-flex items-center gap-1.5 text-xs font-medium"><DesignIcon name="ph:book-open-text" className="h-4 w-4"/>精选内容</span><h2 className="text-[22px] font-semibold leading-tight md:text-3xl">{hero.title}</h2><p className="line-clamp-3 text-sm leading-6 text-white/95">{hero.description}</p><span className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-200">进入看看 <ArrowUpRight className="h-4 w-4"/></span></div>
    </Link> : <State kind="empty" title="精选内容暂未开放"/>}
    <div data-discover-hero-characters className="grid min-h-0 grid-rows-2 gap-3">{characters.slice(0,2).map(character => <CompactCharacter key={character.id} character={character}/>)}{characters.length === 0 && <State kind="empty" title="暂无推荐角色"/>}</div>
  </section>;
}

function CompactCharacter({ character }: { character: ApiCharacter }) {
  return <><button type="button" onClick={() => openDiscoverCharacter(character.id)} aria-haspopup="dialog" className="group flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card text-left active:scale-[.98]">
    <span className="relative block min-h-0 w-full flex-1 overflow-hidden bg-muted">
      <CharacterVisual id={character.id} avatarUrl={character.avatarUrl} alt={character.name} sizes="40vw" className="absolute inset-0 h-full w-full object-cover"/>
      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"/>
      <span className="absolute inset-x-0 bottom-0 p-2.5 text-white"><span className="block truncate text-sm font-semibold">{character.name}</span><span className="mt-1 block truncate text-xs leading-4 text-white/90">AI角色 · {character.tagline || character.personality}</span></span>
      <span className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-primary"><DesignIcon name="ph:chat-circle-text-fill" className="h-4 w-4"/></span>
    </span><span className="block w-full truncate bg-muted px-2.5 py-1.5 text-xs leading-4 text-muted-foreground">{character.greeting || character.tagline || character.personality}</span>
  </button></>;
}

function CharacterCatalogue(props: { types: string[]; setTypes: (values: string[]) => void; roles: string[]; setRoles: (values: string[]) => void; typeFilters: { key: string; label: string }[]; roleFilters: { key: string; label: string }[]; toggle: (list: string[], set: (v: string[]) => void, value: string) => void; catalogueLoading: boolean; catalogueError: string; hasMore: boolean; loadMore: () => void; retryCatalogue: () => void; filtered: ApiCharacter[]; cards: (rows: ApiCharacter[], limit?: number) => ReactNode[]; retry: ReactNode; filtering: boolean }) {
  const { types, setTypes, roles, setRoles, typeFilters, roleFilters, toggle, filtered, cards, retry, filtering, catalogueLoading, catalogueError, hasMore, loadMore, retryCatalogue } = props;
  return <section className="space-y-4 px-4 py-6 md:px-6"><SectionHeader title="角色探索" description="用标签找到合适的聊天对象" />
    <div className="space-y-2 rounded-2xl border border-border bg-card p-4"><FilterRow label="类型：" options={typeFilters} selected={types} onToggle={value => toggle(types, setTypes, value)} /><FilterRow label="角色：" options={roleFilters} selected={roles} onToggle={value => toggle(roles, setRoles, value)} /></div>
    {(types.length > 0 || roles.length > 0) && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">同时满足已选标签</span>{[...types, ...roles].map(key => <button key={key} type="button" onClick={() => { setTypes(types.filter(value => value !== key)); setRoles(roles.filter(value => value !== key)); }} className="min-h-11 rounded-full bg-muted px-3">{[...typeFilters, ...roleFilters].find(tag => tag.key === key)?.label ?? key} ×</button>)}<button type="button" onClick={() => {setTypes([]); setRoles([]);}} className="min-h-11 px-2 text-primary">清除标签</button></div>}
    {catalogueLoading && !filtered.length ? <CharacterSkeleton /> : filtered.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{cards(filtered)}</div> : !catalogueError && <State kind="empty" title={filtering ? '没有符合条件的角色' : '暂无角色'} description={filtering ? '换个关键词或清除部分标签试试。' : '当前没有可展示的角色。'} />}
    {catalogueError && <div role="alert" className="rounded-2xl bg-muted p-4 text-sm"><p>{catalogueError}</p><button type="button" onClick={retryCatalogue} className="mt-2 min-h-11 text-primary">重新加载</button></div>}
    {hasMore && !catalogueError && <div className="text-center"><button type="button" onClick={loadMore} disabled={catalogueLoading} className="min-h-11 rounded-full border border-border px-6 text-sm disabled:opacity-50">{catalogueLoading ? '正在加载…' : '加载更多角色'}</button></div>}

  </section>;
}

function CharacterSkeleton() { return <div role="status" aria-label="正在加载角色" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map(index => <div key={index} className="aspect-[160/213] animate-pulse rounded-2xl bg-muted" />)}</div>; }
