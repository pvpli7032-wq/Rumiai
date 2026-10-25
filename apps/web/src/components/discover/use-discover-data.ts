'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import type {CharacterCardData} from '@/components/characters/character-card';
import type {StoryCatalogEntry} from '@/components/stories/story-catalog-card';
import type {CharacterCatalogPage, DiscoverProjection} from '@rumiai/contracts/public-api';
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

/** Published rails are a server projection; catalogue filtering never truncates to those rails. */
export function useDiscoverData() {
  const {banners, tags, sections} = useSiteContent();
  const {token} = useAuth();
  const config = useUiConfig();
  const mirrorEnabled = config['mirror.enabled'] === true;
  const disputeEnabled = config['dispute.enabled'] === true;
  const {query, setQuery, types, setTypes, roles, setRoles} = useDiscoverState();
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [projection, setProjection] = useState<DiscoverProjection | null>(null);
  const [following, setFollowing] = useState<ApiCharacter[]>([]);
  const [stories, setStories] = useState<StoryCatalogEntry[]>([]);
  const [filtered, setFiltered] = useState<ApiCharacter[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const catalogueRequest = useRef<AbortController | null>(null);
  const filterKey = JSON.stringify([query, types, roles]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    api.get<DiscoverProjection>('/api/explore?view=discover', {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setProjection(data); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  async function loadCatalogue(cursor: string | null = null) {
    catalogueRequest.current?.abort();
    const controller = new AbortController();
    catalogueRequest.current = controller;
    setCatalogueLoading(true);
    setCatalogueError('');
    const params = new URLSearchParams({page: '1', sort: 'popular'});
    if (query.trim()) params.set('search', query.trim());
    for (const tag of [...new Set([...types, ...roles])]) params.append('tag', tag);
    if (cursor) params.set('cursor', cursor);
    try {
      const data = await api.get<CharacterCatalogPage<ApiCharacter>>(API.characters.list(params.toString()), {signal: controller.signal});
      if (controller.signal.aborted) return;
      setFiltered(previous => cursor ? [...new Map([...previous, ...data.items].map(item => [item.id, item])).values()] : data.items);
      setNextCursor(data.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) setCatalogueError(cause instanceof Error ? cause.message : '角色加载失败，请重试。');
    } finally {
      if (!controller.signal.aborted) setCatalogueLoading(false);
    }
  }

  useEffect(() => {
    catalogueRequest.current?.abort();
    setFiltered([]);
    setNextCursor(null);
    setCatalogueLoading(true);
    const timer = setTimeout(() => { void loadCatalogue(); }, 200);
    return () => { clearTimeout(timer); catalogueRequest.current?.abort(); };
  }, [filterKey, reload]);

  useEffect(() => {
    const controller = new AbortController();
    void api.get<{items: StoryCatalogEntry[]}>(API.stories.list(), {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted && Array.isArray(data?.items)) setStories(data.items); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!token) { setFollowing([]); return; }
    const controller = new AbortController();
    void api.get<ApiCharacter[]>(API.characters.list('scope=following'), {token, signal: controller.signal})
      .then(rows => { if (!controller.signal.aborted && Array.isArray(rows)) setFollowing(rows); })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);

  const tagLabels = useMemo(() => new Map(tags.map(tag => [tag.key, tag.label])), [tags]);
  const typeFilters = useMemo(() => tags.filter(tag => tag.filterRow === 'type'), [tags]);
  const roleFilters = useMemo(() => tags.filter(tag => tag.filterRow === 'role'), [tags]);
  const labelsFor = (character: ApiCharacter) => (character.tags ?? '').split(',').map(key => key.trim()).filter(Boolean).map(key => tagLabels.get(key) ?? key);
  const popular = projection?.hot ?? [];
  const fresh = projection?.newest ?? [];
  const recommended = projection?.recommended ?? [];
  const filtering = Boolean(query) || types.length > 0 || roles.length > 0;
  const sceneCharacters = useMemo(() => {
    const pool = new Map<string, ApiCharacter>();
    for (const character of [...popular, ...fresh]) if (getSceneConfigByCharacterId(character.id)) pool.set(character.id, character);
    return getPublishedSceneConfigs().flatMap(scene => {
      const character = pool.get(scene.characterId);
      return character ? [{scene, character}] : [];
    });
  }, [projection]);
  const railItems = (key: string) => projection?.rails.find(rail => rail.key === key)?.items ?? [];
  const toggle = (list: string[], set: (value: string[]) => void, value: string) => set(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);

  return {
    banners, sections, token, mirrorEnabled, disputeEnabled, stories, following, popular,
    query, setQuery, loading, loadError, types, setTypes, roles, setRoles,
    retry: () => setReload(value => value + 1), typeFilters, roleFilters, labelsFor,
    recommended, hot: popular, newest: fresh, filtering, sceneCharacters, filtered, railItems, toggle,
    catalogueLoading, catalogueError, hasMore: Boolean(nextCursor),
    loadMore: () => { if (nextCursor && !catalogueLoading) void loadCatalogue(nextCursor); },
    retryCatalogue: () => { void loadCatalogue(filtered.length ? nextCursor : null); },
  };
}
