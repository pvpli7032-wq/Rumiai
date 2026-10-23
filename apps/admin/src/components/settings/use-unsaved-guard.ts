'use client';

import {useRouter} from 'next/navigation';
import {useCallback, useEffect, useRef} from 'react';

export interface UnsavedNavigationOptions {
  /** 当前编辑器已经接受并正在展示的站内 URL。 */
  location: string;
  /** 只在这类跳转会丢草稿时询问；同一设置分类的小节切换可直接通过。 */
  shouldConfirm: (from: URL, to: URL) => boolean;
  /** 跳转获准后先更新编辑器归属，再让路由完成 URL 变化。 */
  onNavigate: (href: string) => void;
}

export interface GuardedNavigateOptions {replace?: boolean;}

const HISTORY_POSITION_KEY = '__rumiaiSettingsPosition';

/**
 * 设置草稿导航保护：刷新/关页走 beforeunload，站内链接和主动按钮共用一次确认，
 * 浏览器后退/前进在 popstate 后决定接受或恢复当前 URL。编辑器状态不直接由 URL
 * 驱动，因此取消 popstate 时草稿和当前分类都不会短暂切走。
 */
export function useUnsavedGuard(dirty: boolean, message?: string): (href: string, options?: GuardedNavigateOptions) => boolean;
export function useUnsavedGuard(dirty: boolean, options: UnsavedNavigationOptions, message?: string): (href: string, options?: GuardedNavigateOptions) => boolean;
export function useUnsavedGuard(
  dirty: boolean,
  optionsOrMessage: UnsavedNavigationOptions | string = '当前页面有未保存的修改，确定离开吗？',
  customMessage = '当前页面有未保存的修改，确定离开吗？',
) {
  const router = useRouter();
  const options = typeof optionsOrMessage === 'string' ? null : optionsOrMessage;
  const configuredNavigation = Boolean(options);
  const message = typeof optionsOrMessage === 'string' ? optionsOrMessage : customMessage;
  const dirtyRef = useRef(dirty);
  const optionsRef = useRef(options);
  const messageRef = useRef(message);
  const positionRef = useRef(0);
  const restoringPop = useRef(false);
  dirtyRef.current = dirty;
  optionsRef.current = options;
  messageRef.current = message;

  const navigate = useCallback((href: string, navigateOptions: GuardedNavigateOptions = {}) => {
    const configured = optionsRef.current;
    const current = new URL(configured?.location ?? window.location.href, window.location.origin);
    const target = new URL(href, window.location.href);
    const targetHref = target.pathname + target.search + target.hash;
    if (target.origin !== window.location.origin) return false;
    if (targetHref === current.pathname + current.search + current.hash) return true;
    if (dirtyRef.current && (configured?.shouldConfirm(current, target) ?? true) && !window.confirm(messageRef.current)) return false;
    configured?.onNavigate(targetHref);
    const settingsHistoryNavigation = configured && current.pathname === '/admin/settings' && target.pathname === '/admin/settings';
    if (settingsHistoryNavigation) {
      const nextPosition = navigateOptions.replace ? positionRef.current : positionRef.current + 1;
      positionRef.current = nextPosition;
      const state = {[HISTORY_POSITION_KEY]: nextPosition};
      if (navigateOptions.replace) window.history.replaceState(state, '', targetHref);
      else window.history.pushState(state, '', targetHref);
    } else if (navigateOptions.replace) router.replace(targetHref, {scroll: false});
    else router.push(targetHref, {scroll: false});
    return true;
  }, [router]);

  useEffect(() => {
    if (!options) return;
    const position = window.history.state?.[HISTORY_POSITION_KEY];
    if (typeof position === 'number') {
      positionRef.current = position;
      return;
    }
    const currentHref = window.location.pathname + window.location.search + window.location.hash;
    window.history.replaceState({[HISTORY_POSITION_KEY]: positionRef.current}, '', currentHref);
  }, [options?.location]);

  useEffect(() => {
    if (!dirty && !configuredNavigation) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Clean settings-to-other-page links remain ordinary Next navigation; only same-page query history needs our marker.
      if (!dirtyRef.current && optionsRef.current && url.pathname !== '/admin/settings') return;
      const next = url.pathname + url.search + url.hash;
      if (next === (optionsRef.current?.location ?? window.location.pathname + window.location.search + window.location.hash)) return;
      event.preventDefault();
      navigate(next);
    }

    function onPopState(event: PopStateEvent) {
      if (!optionsRef.current) return;
      const targetPosition = event.state?.[HISTORY_POSITION_KEY];
      if (restoringPop.current) {
        restoringPop.current = false;
        if (typeof targetPosition === 'number') positionRef.current = targetPosition;
        return;
      }
      const target = new URL(window.location.href);
      const current = new URL(optionsRef.current.location, window.location.origin);
      const targetHref = target.pathname + target.search + target.hash;
      const currentHref = current.pathname + current.search + current.hash;
      if (targetHref === currentHref) return;
      if (dirtyRef.current && optionsRef.current.shouldConfirm(current, target) && !window.confirm(messageRef.current)) {
        if (typeof targetPosition === 'number' && targetPosition !== positionRef.current) {
          restoringPop.current = true;
          window.history.go(positionRef.current - targetPosition);
        } else {
          router.replace(currentHref, {scroll: false});
        }
        return;
      }
      if (typeof targetPosition === 'number') positionRef.current = targetPosition;
      optionsRef.current.onNavigate(targetHref);
    }

    if (dirty) window.addEventListener('beforeunload', onBeforeUnload);
    if (configuredNavigation) window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      if (dirty) window.removeEventListener('beforeunload', onBeforeUnload);
      if (configuredNavigation) window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [configuredNavigation, dirty, navigate, router]);

  return navigate;
}
