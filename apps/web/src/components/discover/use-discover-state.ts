'use client';

import { useSearchParams } from 'next/navigation';

const views = { '推荐': 'recommended', '角色': 'characters', '世界观': 'universes', '创作者': 'creators', '榜单': 'rankings' } as const;
type Mode = keyof typeof views;

// Read the current URL for each update so consecutive filter changes compose.
function update(values: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function openDiscoverCharacter(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('character', id);
  window.history.pushState(null, '', url.pathname + url.search + url.hash);
}

export function useDiscoverState() {
  const params = useSearchParams();
  const query = params.get('q') || '';
  const list = (key: string) => [...new Set((params.get(key) || '').split(',').map(value => value.trim()).filter(Boolean))];
  const types = list('type');
  const roles = list('role');
  const mode = (Object.keys(views) as Mode[]).find(key => views[key] === params.get('view'))
    ?? (query || types.length || roles.length ? '角色' : '推荐');
  const rawBatch = Number(params.get('batch'));
  const batch = Number.isSafeInteger(rawBatch) && rawBatch > 0 ? rawBatch : 0;
  const detailId = params.get('character');
  const withoutDetail = new URLSearchParams(params.toString());
  withoutDetail.delete('character');
  return {
    query, types, roles, mode, batch, detailId,
    detailFallback: '/discover' + (withoutDetail.size ? '?' + withoutDetail.toString() : ''),
    setQuery: (value: string) => update({ q: value }),
    setTypes: (value: string[]) => update({ type: value.join(',') }),
    setRoles: (value: string[]) => update({ role: value.join(',') }),
    setMode: (value: Mode) => update({ view: views[value] }),
    setBatch: (value: number | ((previous: number) => number)) => update({ batch: String(typeof value === 'function' ? value(batch) : value) }),
  };
}
