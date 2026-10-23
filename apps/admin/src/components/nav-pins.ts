'use client';

import {useCallback, useEffect, useState} from 'react';
import {ADMIN_NAV, canSeeEntry, type AdminNavEntry} from '@rumiai/contracts/admin/nav';
import type {AdminPermission} from '@rumiai/contracts/admin/permissions';

/**
 * 后台侧栏「常用」置顶（V3 §13：常用入口可置顶最多 4 项）。
 *
 * 存 localStorage 而不是建表：这是每个管理员自己的显示偏好，不影响他人、不参与
 * 权限判定，也没有跨设备同步的需求；仓库里没有管理员个人偏好的服务端能力，为四项
 * 置顶加一张表与一套接口不划算。键里带管理员 id，换人登录读到的是自己的那一份。
 */

/** V3 §13 的上限。 */
export const PIN_LIMIT = 4;

const STORAGE_PREFIX = 'admin.nav.pins.';
const ALL_ENTRIES = ADMIN_NAV.flatMap(group => group.entries);
const ENTRY_BY_HREF = new Map(ALL_ENTRIES.map(entry => [entry.href, entry]));

function storageKey(userId: string): string {
  return STORAGE_PREFIX + userId;
}

/** 读出本人置顶的 href。失效条目（导航里已经删掉的入口）顺手丢掉。 */
function readPins(userId: string | null): string[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((href): href is string => typeof href === 'string' && ENTRY_BY_HREF.has(href))
      .slice(0, PIN_LIMIT);
  } catch {
    return [];
  }
}

function writePins(userId: string | null, pins: string[]): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(pins));
  } catch {
    /* 隐私模式写不进去：本次会话仍然生效，只是刷新后回到未置顶。 */
  }
}

/**
 * 置顶项按权限过滤：没有权限的入口不显示，置顶不能越过权限判定。
 *
 * 条目本身从导航表里取，所以标题、图标、链接只有一处出处。
 */
export function pinnedEntries(pins: readonly string[], permissions: readonly AdminPermission[]): AdminNavEntry[] {
  const entries: AdminNavEntry[] = [];
  for (const href of pins) {
    const entry = ENTRY_BY_HREF.get(href);
    if (entry && canSeeEntry(entry, permissions)) entries.push(entry);
  }
  return entries;
}

export interface NavPins {
  /** 本人的置顶 href，按置顶顺序。 */
  pins: string[];
  /** 一句中文回执；超过上限时是拒绝原因。 */
  notice: string;
  toggle: (entry: AdminNavEntry) => void;
}

/** 某个管理员的置顶状态。userId 为空（还没登录）时不读不写。 */
export function useNavPins(userId: string | null): NavPins {
  const [pins, setPins] = useState<string[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setPins(readPins(userId));
    setNotice('');
  }, [userId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggle = useCallback(
    (entry: AdminNavEntry) => {
      const pinned = pins.includes(entry.href);
      // 满 4 项时拒绝新增：不静默丢弃，也不顶掉最早的那个，让操作者自己决定换掉谁。
      if (!pinned && pins.length >= PIN_LIMIT) {
        setNotice(`常用最多 ${PIN_LIMIT} 项，请先取消一个再置顶。`);
        return;
      }
      const next = pinned ? pins.filter(href => href !== entry.href) : [...pins, entry.href];
      setPins(next);
      writePins(userId, next);
      setNotice(pinned ? `已取消置顶「${entry.label}」。` : `已置顶「${entry.label}」。`);
    },
    [pins, userId],
  );

  return {pins, notice, toggle};
}
