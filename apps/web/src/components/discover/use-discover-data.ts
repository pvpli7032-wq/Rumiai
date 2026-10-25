'use client';

import {useEffect, useMemo, useState} from 'react';
import type {CharacterCardData} from '@/components/characters/character-card';
import type {StoryCatalogEntry} from '@/components/stories/story-catalog-card';
import {getPublishedSceneConfigs} from '@rumiai/contracts/stories/scene-service';
import {getSceneConfigByCharacterId} from '@rumiai/contracts/stories/scene-config';
import {useSiteContent} from '@web/lib/use-site-content';
import {useUiConfig} from '@web/lib/settings/use-ui-config';
import {useAuth} from '@web/lib/auth-context';
import {api} from '@web/lib/api-client';
import {useDiscoverState} from './use-discover-state';
import {API} from '@rumiai/contracts/api-paths';

export interface ApiCharacter extends CharacterCardData {
  createdAt: string;
  greeting?: string | null;
}

/**
 * 发现页的数据层：三个角色分区、故事目录、筛选与分区派生结果。
 * 渲染在 discover/page.tsx 与 discover-parts.tsx，这里不含 JSX。
 */
export function useDiscoverData() {
  const {banners, tags, sections} = useSiteContent();
  const {token} = useAuth();
  // 「他眼中的你」是独立玩法，开关（mirror.enabled）关掉时这里整块不渲染，
  // 免得留一个点进去是空页的入口。配置未加载按关闭处理，不先闪出一个死链。
  const config = useUiConfig();
  const mirrorEnabled = config['mirror.enabled'] === true;
  const disputeEnabled = config['dispute.enabled'] === true;
  const {query, setQuery, types, setTypes, roles, setRoles} = useDiscoverState();
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [popular, setPopular] = useState<ApiCharacter[]>([]);
  const [fresh, setFresh] = useState<ApiCharacter[]>([]);
  const [following, setFollowing] = useState<ApiCharacter[]>([]);
  const [stories, setStories] = useState<StoryCatalogEntry[]>([]);

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
  }, [reload]);

  // 已发布的故事模板。公开目录，匿名也取；失败就不显示该分区，不影响发现页其它内容。
  useEffect(() => {
    const controller = new AbortController();
    void api
      .get<{items: StoryCatalogEntry[]}>(API.stories.list(), { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data?.items)) setStories(data.items);
      })
      .catch(() => {});
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

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return {
    banners, sections, token, mirrorEnabled, disputeEnabled, stories, following, popular,
    query, setQuery, loading, loadError, types, setTypes, roles, setRoles, retry: () => setReload(value => value + 1),
    typeFilters, roleFilters, labelsFor, recommended, hot, newest, filtering,
    sceneCharacters, filtered, railItems, toggle,
  };
}
