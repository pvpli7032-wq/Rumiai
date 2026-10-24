'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {DesignIcon} from '@/components/primitives/design-icon';

/** Keep the existing panels mounted so hiding the sheet preserves unsaved fields. */
export function ChatPanelSheet({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}) {
  const titleId=useId();
  const panel=useRef<HTMLDivElement>(null);
  const close=useRef<HTMLButtonElement>(null);
  const closeAction=useRef(onClose);
  closeAction.current=onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    close.current?.focus();
    const keydown=(event:KeyboardEvent) => {
      if (event.key==='Escape') {event.preventDefault();closeAction.current();return;}
      if (event.key!=='Tab') return;
      const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length>0);
      const first=controls[0],last=controls[controls.length-1];
      if (!first || !last) {event.preventDefault();return;}
      if (event.shiftKey && (document.activeElement===first || !panel.current?.contains(document.activeElement))) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && (document.activeElement===last || !panel.current?.contains(document.activeElement))) {event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);
    return () => {document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow;previousFocus?.focus();};
  },[open]);
  return <div hidden={!open} className="fixed inset-0 z-[70]">
    <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(var(--app-height,100dvh)-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-[24px] border border-border bg-card text-foreground shadow-xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[24px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3"><h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold">{title}</h2><button ref={close} type="button" onClick={onClose} aria-label="关闭关系与记忆" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"><DesignIcon name="ph:plus" size={20} className="rotate-45" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  </div>;
}
