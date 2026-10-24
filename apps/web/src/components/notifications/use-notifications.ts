'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {apiFetch} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import type {NotificationItem, NotificationPage} from '@rumiai/contracts/notifications/types';

export interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  error: boolean;
  actionBusy: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

function pagePath(cursor: string | null): string {
  return cursor ? API.me.notifications + '?cursor=' + encodeURIComponent(cursor) : API.me.notifications;
}

/** 追加时按 id 去重：翻页与刷新交错时不会出现两条一样的通知。 */
function merge(current: NotificationItem[], incoming: NotificationItem[]): NotificationItem[] {
  const seen = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => !seen.has(item.id))];
}

/**
 * 顶栏与抽屉共用的通知状态。红点计数、列表都来自同一个接口，操作后按服务端
 * 返回值校准，未读红点和抽屉里的未读标记不会各说各话。
 */
export function useNotifications(token: string | null): NotificationState {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(false);
    try {
      const page = await apiFetch<NotificationPage>(pagePath(null), {token});
      if (!mounted.current) return;
      setItems(page.items);
      setUnreadCount(page.unreadCount);
      setCursor(page.nextCursor);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [token]);

  const loadMore = useCallback(async () => {
    if (!token || !cursor || loading) return;
    setLoading(true);
    try {
      const page = await apiFetch<NotificationPage>(pagePath(cursor), {token});
      if (!mounted.current) return;
      setItems(previous => merge(previous, page.items));
      setUnreadCount(page.unreadCount);
      setCursor(page.nextCursor);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [token, cursor, loading]);

  const markRead = useCallback(
    async (id: string) => {
      if (!token || actionRef.current) return;
      const previousItems = items;
      const previousUnread = unreadCount;
      setActionBusy(true);
      actionRef.current = true;
      const now = new Date().toISOString();
      // 先本地置已读，点进业务对象时红点立刻减一；再用服务端计数校准。
      setItems(previous => previous.map(item => (item.id === id && !item.readAt ? {...item, readAt: now} : item)));
      try {
        const result = await apiFetch<{unreadCount: number}>(API.me.notification(id), {method: 'PATCH', token});
        if (mounted.current) setUnreadCount(result.unreadCount);
      } catch {
        if (mounted.current) { setItems(previousItems); setUnreadCount(previousUnread); setError(true); }
      } finally {
        actionRef.current = false;
        if (mounted.current) setActionBusy(false);
      }
    },
    [token, actionBusy, items, unreadCount],
  );

  const markAllRead = useCallback(async () => {
    if (!token || actionRef.current) return;
    const previousItems = items;
    const previousUnread = unreadCount;
    setActionBusy(true);
    actionRef.current = true;
    const now = new Date().toISOString();
    setItems(previous => previous.map(item => (item.readAt ? item : {...item, readAt: now})));
    setUnreadCount(0);
    try {
      const result = await apiFetch<{unreadCount: number}>(API.me.notifications, {method: 'POST', token});
      if (mounted.current) setUnreadCount(result.unreadCount);
    } catch {
      if (mounted.current) { setItems(previousItems); setUnreadCount(previousUnread); setError(true); }
    } finally {
      actionRef.current = false;
      if (mounted.current) setActionBusy(false);
    }
  }, [token, actionBusy, items, unreadCount]);

  useEffect(() => {
    if (!token) {
      setItems([]);
      setUnreadCount(0);
      setCursor(null);
      setError(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [token, refresh]);

  // 回到页面时补一次：不轮询、不推送，避免把站内通知做成打扰。
  useEffect(() => {
    if (!token) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, refresh]);

  return {items, unreadCount, loading, error, actionBusy, hasMore: cursor !== null, refresh, loadMore, markRead, markAllRead};
}
