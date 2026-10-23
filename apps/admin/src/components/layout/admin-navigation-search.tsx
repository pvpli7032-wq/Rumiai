'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight, Search, X} from 'lucide-react';
import type {AdminNavGroup} from '@rumiai/contracts/admin/nav';

/** Searches the permission-filtered navigation, never a second route/permission registry. */
export function AdminNavigationSearch({groups}: {groups: AdminNavGroup[]}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); }
      if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  const term = query.trim().toLowerCase();
  const entries = groups.flatMap(group => group.entries.map(entry => ({...entry, group: group.label})))
    .filter(entry => `${entry.label} ${entry.group} ${entry.description}`.toLowerCase().includes(term));
  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-label="搜索后台栏目" aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground">
      <Search className="h-4 w-4" aria-hidden />
      <span className="hidden xl:inline">搜索栏目</span>
      <kbd className="ml-4 hidden text-[10px] text-muted-foreground xl:inline">Ctrl K</kbd>
    </button>
    {open && <div className="fixed inset-x-4 top-20 z-40 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[360px]" role="region" aria-label="栏目快捷搜索">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-brand" />
        <input ref={input} type="search" aria-label="输入栏目名称" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索栏目或功能…" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <button type="button" aria-label="关闭栏目搜索" className="rounded-md p-1.5 hover:bg-muted" onClick={close}><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[60dvh] overflow-y-auto p-2">
        {entries.length ? entries.map(entry => <Link key={entry.href} href={entry.href} onClick={() => { setOpen(false); setQuery(''); }} className="group flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-brand-soft focus-visible:bg-brand-soft">
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{entry.label}<span className="ml-2 text-xs font-normal text-muted-foreground">{entry.group}</span></span><span className="mt-1 block truncate text-xs text-muted-foreground">{entry.description}</span></span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
        </Link>) : <p className="p-6 text-center text-sm text-muted-foreground">未找到可访问的栏目</p>}
      </div>
    </div>}
  </div>;
}
