'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNav } from './mobile-nav';

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const chat = pathname === '/chat';

  useEffect(() => {
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      document.documentElement.dataset.keyboard = String(height < window.innerHeight * .8);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useLayoutEffect(() => {
    const el = scroll.current;
    const inner = content.current;
    if (!el || !inner) return;
    const key = `xingban-scroll:${pathname}`;
    const target = Math.max(0, Number(sessionStorage.getItem(key) || 0));
    let restoring = target > 0;
    el.scrollTop = 0;
    const restore = () => {
      if (!restoring) return;
      const available = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.min(target, available);
      // Keep the target through route placeholders and async layout changes.
      // The first user interaction takes ownership of scrolling.
    };
    // Wait for async cards/images to provide enough height before saving scroll.
    const observer = new ResizeObserver(restore);
    observer.observe(inner);
    const frame = requestAnimationFrame(restore);
    const save = () => { if (!restoring) sessionStorage.setItem(key, String(el.scrollTop)); };
    const takeControl = () => { restoring = false; save(); };
    el.addEventListener('scroll', save, { passive: true });
    el.addEventListener('wheel', takeControl, { passive: true });
    el.addEventListener('touchstart', takeControl, { passive: true });
    el.addEventListener('pointerdown', takeControl);
    el.addEventListener('keydown', takeControl);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('scroll', save);
      el.removeEventListener('wheel', takeControl);
      el.removeEventListener('touchstart', takeControl);
      el.removeEventListener('pointerdown', takeControl);
      el.removeEventListener('keydown', takeControl);
    };
  }, [pathname]);

  return (
    <div className={`app-frame flex w-full min-w-0 desktop:flex-row ${chat ? 'is-chat' : ''}`}>
      <Sidebar />
      <div ref={scroll} className={`app-content min-h-0 min-w-0 flex-1 bg-background ${chat ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
        <div ref={content} className={chat ? 'flex h-full min-h-0 flex-col' : 'min-h-full'}>
          {!chat && <Topbar />}{children}
        </div>
      </div>
      <MobileNav />
    </div>
  );
}
