'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {DesignIcon} from '@/components/primitives/design-icon';

/** Keep the existing panels mounted so hiding the sheet preserves unsaved fields. */
export function ChatPanelSheet({open,onClose,title,children,size='content',placement='bottom'}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;size?:'content'|'half';placement?:'bottom'|'right'}) {
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
    const motion=placement==='right'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?panel.current?.animate([{transform:'translateX(100%)'},{transform:'translateX(0)'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'}):undefined;
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
    return () => {motion?.cancel();document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow;previousFocus?.focus();};
  },[open,placement]);
  return <div hidden={!open} className="fixed inset-0 z-[70]">
    <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={'absolute flex flex-col overflow-hidden bg-card text-foreground shadow-xl '+(placement==='right'?'inset-y-0 right-0 h-full border-l border-border '+(size==='half'?'w-1/2 max-w-sm':'w-full max-w-xl'):'inset-x-0 bottom-0 mx-auto max-h-[calc(var(--app-height,100dvh)-1rem)] w-full max-w-xl rounded-t-[24px] border border-border sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[24px]')}>
      <header className={"flex shrink-0 items-center gap-2 border-b border-border py-3 "+(placement==='right'&&size==='half'?'px-3':'px-5')}><h2 id={titleId} className={"min-w-0 flex-1 font-medium "+(placement==='right'&&size==='half'?'text-[15px]':'text-lg')}>{title}</h2><button ref={close} type="button" onClick={onClose} aria-label={'关闭' + title} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"><DesignIcon name="ph:plus" size={20} className="rotate-45" /></button></header>
      <div className={"min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-4 pb-[max(1rem,env(safe-area-inset-bottom))] "+(placement==='right'&&size==='half'?'px-2':'px-4')}>{children}</div>
    </div>
  </div>;
}
