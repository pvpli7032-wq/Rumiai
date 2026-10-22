import {SETTINGS_CACHE_TTL_MS} from './types';
import type {JsonValue} from './types';

/**
 * 进程内设置缓存。
 *
 * 为什么要有：一次聊天请求要读十几项设置，逐项查库会把一个请求变成十几次往返。
 * 为什么是 15 秒：V3 §11 要求「保存后本进程立即失效，其他任务进程最多 15 秒刷新」。
 * 时长常量在 types.ts（设置中心要显示同一个数）。
 * 缓存键带用户 ID，用户特例与公共值分开存，避免相互污染。
 */
type Entry = {value: JsonValue; source: 'USER' | 'GLOBAL' | 'DEFAULT'; version: number; expiresAt: string | null; updatedAt: string | null; at: number};
const store = new Map<string, Entry>();

export function cacheKey(userId: string | null | undefined, key: string): string {
  return (userId ?? '-') + '|' + key;
}

export function readCache(key: string): Entry | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > SETTINGS_CACHE_TTL_MS) { store.delete(key); return undefined; }
  return hit;
}

export function writeCache(key: string, entry: Omit<Entry, 'at'>): void {
  store.set(key, {...entry, at: Date.now()});
}

export function clearCache(key?: string): void {
  if (key === undefined) { store.clear(); return; }
  store.delete(key);
}

/** 保存后清掉这一项的所有用户视图（公共值变了，所有人的读法都变）。 */
export function clearKeyEverywhere(key: string): void {
  for (const cache of store.keys()) {
    if (cache.endsWith('|' + key)) store.delete(cache);
  }
}
