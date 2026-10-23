'use client';

import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

/**
 * 离开未保存页面时提醒一次（V3 §16）。
 *
 * 两层：浏览器刷新/关闭走 beforeunload；站内跳转（侧栏、面包屑）拦一次点击。
 * 只提醒，不自动保存，也不阻止用户确认后离开。
 */
export function useUnsavedGuard(dirty: boolean, message = '当前页面有未保存的修改，确定离开吗？') {
  const router = useRouter();

  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      if (window.confirm(message)) router.push(url.pathname + url.search + url.hash);
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message, router]);
}
