'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { compactNumber } from '@web/lib/i18n';

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function onKey(event: KeyboardEvent) {
      const overlays = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (overlays[overlays.length - 1] !== dialog.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
      const first=items[0], last=items[items.length-1];
      if(!first) {event.preventDefault(); dialog.current?.focus(); return;}
      if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog.current)) {event.preventDefault(); last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || document.activeElement===dialog.current)) {event.preventDefault(); first.focus();}
    }
    document.addEventListener('keydown',onKey);
    return () => {document.body.style.overflow=overflow; document.removeEventListener('keydown',onKey); previous?.focus();};
  },[]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-6" onClick={onClose} role="presentation"><div ref={dialog} tabIndex={-1} className="h-full max-h-full w-full max-w-2xl overflow-y-auto overscroll-contain bg-background text-foreground outline-none sm:h-auto sm:max-h-[92dvh] sm:rounded-[24px] sm:border sm:border-border" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="角色详情">{children}</div></div>;
}

export function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? "上一张图片" : "下一张图片"}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

export function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      {compactNumber(value)}
    </span>
  );
}

export function IconAction({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled || undefined}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-bold transition-colors ${
        active
          ? 'border-brand-strong/50 bg-brand-strong/10 text-brand-strong'
          : 'border-border text-muted-foreground hover:bg-muted'
      } disabled:cursor-wait disabled:opacity-60`}
    >
      {icon}
      {label}
    </button>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative min-h-11 shrink-0 px-3 pb-2 text-sm font-bold transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-muted-foreground'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--action)]" />}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded,setExpanded]=useState(false);
  const long=typeof children==='string'&&children.length>300;
  return (
    <div className="rounded-[20px] border border-border bg-card p-4">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{long&&!expanded?String(children).slice(0,280)+'…':children}</p>
      {long&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)} className="mt-2 min-h-11 text-sm text-primary">{expanded?'收起':'展开完整'+title}</button>}
    </div>
  );
}
