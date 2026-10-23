'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';
import {Portal} from '@rumiai/ui/portal';
import {cn} from '@rumiai/ui/cn';

/**
 * 详情抽屉：列表里点一行就地看详情，不离开列表（V3 §15）。
 * 手机端由 Sheet 自带的整宽侧滑承担，内容区可滚动，底部动作固定。
 */
export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const WIDTHS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-[min(960px,calc(100vw-64px))]',
} as const;

export function DetailDrawer({open, onClose, title, description, children, footer, size = 'md'}: DetailDrawerProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = document.querySelector<HTMLElement>('[data-admin-shell]');
    const wasInert = shell?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (shell) shell.inert = true;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => panel.current?.focus());
    function onKey(event: KeyboardEvent) {
      const layers = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(node => node.getClientRects().length > 0);
      if (layers.at(-1) !== panel.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter(node => node.getClientRects().length > 0 && !node.closest('[hidden]'));
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); panel.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      if (shell) shell.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, [open]);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50">
        <div aria-hidden className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]" onClick={onClose} />
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1} className={cn('admin-detail-drawer absolute inset-y-0 right-0 flex h-dvh w-full flex-col border-l border-border bg-background text-foreground shadow-2xl outline-none', WIDTHS[size])}>
          <header className="flex shrink-0 items-start gap-4 border-b border-border bg-card px-5 py-5 sm:px-6">
            <span aria-hidden className="mt-1 h-6 w-1 shrink-0 rounded-full bg-brand" />
            <div className="min-w-0 flex-1"><h2 id={`${id}-title`} className="break-words text-lg font-semibold tracking-tight">{title}</h2>{description && <p id={`${id}-description`} className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">{description}</p>}</div>
            <button type="button" onClick={onClose} aria-label="关闭详情" title="关闭详情（Esc）" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
          {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

/** 抽屉内的一节：小标题 + 内容，节与节之间留统一间距。 */
export function DetailSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 space-y-3 rounded-xl border border-border bg-card p-4', className)}>
      {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
      {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

/** 「名称：值」一行，详情里反复出现，宽度不足时自动换行而不是溢出。 */
export function DetailRow({label, children}: {label: ReactNode; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-border/50 py-2.5 text-sm last:border-0 sm:flex-row sm:gap-3">
      <span className="shrink-0 text-muted-foreground sm:w-28">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}
