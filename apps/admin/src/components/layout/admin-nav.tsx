'use client';

import {useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {
  Activity, BarChart3, Bell, Bot, ChevronDown, ChevronRight, ClipboardList, Coins, Cpu, FileText, Gift, KeyRound,
  Landmark, LayoutDashboard, LayoutTemplate, MessageSquare, Pin, PinOff, RefreshCw, Scale, ScrollText, Settings,
  ShieldCheck, Sparkles, UserCog, Users, Wallet, Crown, type LucideIcon,
} from 'lucide-react';
import {activeNavHref, findEntry, type AdminNavEntry, type AdminNavGroup, type AdminNavIcon} from '@rumiai/contracts/admin/nav';
import type {AdminPermission} from '@rumiai/contracts/admin/permissions';
import {cn} from '@rumiai/ui/cn';
import {pinnedEntries} from '../nav-pins';

const ICONS: Record<AdminNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, characters: Users, moderation: ShieldCheck, circles: UserCog, posts: FileText,
  comments: MessageSquare, accounts: UserCog, analytics: BarChart3, growth: Gift, 'site-content': LayoutTemplate,
  finance: Wallet, memberships: Crown, merchants: Landmark, 'ai-providers': Bot, 'ai-models': Cpu,
  'ai-costs': Coins, operations: Activity, compliance: ScrollText, operators: KeyRound, audit: ClipboardList,
  mirror: Sparkles, disputes: Scale, tasks: RefreshCw, notifications: Bell, settings: Settings,
};

const OPEN_STATE_PREFIX = 'admin.nav.open.';

interface OpenState {groups: string[]; entries: string[]; lastActiveBranch: string | null;}

export interface AdminNavProps {
  location: string;
  groups: AdminNavGroup[];
  permissions: readonly AdminPermission[];
  storageScope: string | null;
  pins: readonly string[];
  onTogglePin: (entry: AdminNavEntry) => void;
  pinNotice: string;
  rail?: boolean;
  onNavigate?: () => void;
}

function readOpenState(scope: string | null): {state: OpenState; hasLastActiveBranch: boolean} {
  if (!scope || typeof window === 'undefined') return {state: {groups: [], entries: [], lastActiveBranch: null}, hasLastActiveBranch: false};
  try {
    const raw = window.localStorage.getItem(OPEN_STATE_PREFIX + scope);
    if (raw === null) return {state: {groups: [], entries: [], lastActiveBranch: null}, hasLastActiveBranch: false};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {state: {groups: [], entries: [], lastActiveBranch: null}, hasLastActiveBranch: false};
    const value = parsed as Partial<OpenState>;
    const hasLastActiveBranch = typeof value.lastActiveBranch === 'string';
    return {state: {
      groups: Array.isArray(value.groups) ? value.groups.filter(item => typeof item === 'string') : [],
      entries: Array.isArray(value.entries) ? value.entries.filter(item => typeof item === 'string') : [],
      lastActiveBranch: hasLastActiveBranch ? value.lastActiveBranch as string : null,
    }, hasLastActiveBranch};
  } catch { return {state: {groups: [], entries: [], lastActiveBranch: null}, hasLastActiveBranch: false}; }
}

function PinButton({entry, pinned, onToggle}: {entry: AdminNavEntry; pinned: boolean; onToggle: (entry: AdminNavEntry) => void}) {
  const Icon = pinned ? PinOff : Pin;
  const label = pinned ? `取消置顶「${entry.label}」` : `置顶「${entry.label}」`;
  return <button type="button" onClick={() => onToggle(entry)} title={label} aria-label={label} className={cn(
    'admin-nav-pin flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    pinned && 'text-brand hover:text-brand',
  )}><Icon aria-hidden className="h-3.5 w-3.5" /></button>;
}

function NavLinkRow({entry, active, pinned, onTogglePin, onNavigate}: {
  entry: AdminNavEntry; active: boolean; pinned: boolean; onTogglePin: (entry: AdminNavEntry) => void; onNavigate?: () => void;
}) {
  const Icon = ICONS[entry.icon];
  return <div className={cn('admin-nav-row flex items-center gap-1 rounded-lg pr-1 transition-colors', active ? 'admin-nav-active bg-brand-soft' : 'hover:bg-accent')}>
    <Link href={entry.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn(
      'relative flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors',
      active ? 'text-brand' : 'text-muted-foreground hover:text-foreground',
    )}>
      {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />}
      <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{entry.label}</span>
    </Link>
    <PinButton entry={entry} pinned={pinned} onToggle={onTogglePin} />
  </div>;
}

function NavBranch({entry, currentHref, currentEntry, open, pinned, onToggleOpen, onTogglePin, onNavigate}: {
  entry: AdminNavEntry; currentHref: string | null; currentEntry: boolean; open: boolean; pinned: boolean;
  onToggleOpen: () => void; onTogglePin: (entry: AdminNavEntry) => void; onNavigate?: () => void;
}) {
  const Icon = ICONS[entry.icon];
  return <div className="rounded-lg">
    <div className="flex items-center gap-1 pr-1">
      <button type="button" aria-expanded={open} onClick={onToggleOpen} className={cn(
        'flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors hover:bg-accent',
        currentEntry ? 'text-brand' : 'text-muted-foreground hover:text-foreground',
      )}>
        <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>
      <PinButton entry={entry} pinned={pinned} onToggle={onTogglePin} />
    </div>
    {open && <div className="mb-1 ml-5 space-y-0.5 border-l border-border pl-2">
      {entry.children?.map(child => {
        const active = currentEntry && currentHref === child.href;
        return <Link key={child.href} href={child.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn(
          'relative flex min-h-9 items-center rounded-md px-3 text-xs transition-colors',
          active ? 'bg-brand-soft font-semibold text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}>
          {active && <span aria-hidden className="absolute -left-[9px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />}
          <span className="truncate">{child.label}</span>
        </Link>;
      })}
    </div>}
  </div>;
}

export function AdminNav({location, groups, permissions, storageScope, pins, onTogglePin, pinNotice, rail = false, onNavigate}: AdminNavProps) {
  const current = findEntry(location, permissions);
  const currentHref = activeNavHref(location, permissions);
  const [open, setOpen] = useState<OpenState>({groups: [], entries: [], lastActiveBranch: null});
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const activeBranch = current ? `${current.group.id}:${current.entry.href}` : null;
  const currentGroupId = current?.group.id ?? null;
  const currentEntryHref = current?.entry.href ?? null;
  const currentEntryHasChildren = Boolean(current?.entry.children?.length);
  const pinned = pinnedEntries(pins, permissions);
  const pinnedHrefs = useMemo(() => new Set(pinned.map(entry => entry.href)), [pinned]);

  useEffect(() => {
    const saved = readOpenState(storageScope);
    const state = {...saved.state, groups: [...saved.state.groups], entries: [...saved.state.entries]};
    const enteringNewBranch = Boolean(activeBranch && (!saved.hasLastActiveBranch || saved.state.lastActiveBranch !== activeBranch));
    // 首次进入或旧格式没有 lastActiveBranch 时帮助操作者看见当前位置；同一分支的明确收起保持不变。
    if (enteringNewBranch && current && !state.groups.includes(current.group.id)) state.groups.push(current.group.id);
    if (enteringNewBranch && current?.entry.children?.length && !state.entries.includes(current.entry.href)) state.entries.push(current.entry.href);
    if (activeBranch) state.lastActiveBranch = activeBranch;
    setOpen(state);
    setHydratedScope(storageScope);
    // storageScope 变化代表换了管理员；路由变化由下面的精确 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageScope]);

  useEffect(() => {
    if (hydratedScope !== storageScope || !activeBranch) return;
    setOpen(value => {
      if (value.lastActiveBranch === activeBranch) return value;
      return {
        lastActiveBranch: activeBranch,
        groups: currentGroupId && !value.groups.includes(currentGroupId) ? [...value.groups, currentGroupId] : value.groups,
        entries: currentEntryHasChildren && currentEntryHref && !value.entries.includes(currentEntryHref)
          ? [...value.entries, currentEntryHref]
          : value.entries,
      };
    });
  }, [activeBranch, currentEntryHasChildren, currentEntryHref, currentGroupId, hydratedScope, storageScope]);

  useEffect(() => {
    if (!storageScope || hydratedScope !== storageScope) return;
    try { window.localStorage.setItem(OPEN_STATE_PREFIX + storageScope, JSON.stringify(open)); } catch { /* 私密模式只保留本次会话。 */ }
  }, [hydratedScope, open, storageScope]);

  function toggleGroup(id: string) {
    setOpen(value => ({...value, groups: value.groups.includes(id) ? value.groups.filter(item => item !== id) : [...value.groups, id]}));
  }
  function toggleEntry(href: string) {
    setOpen(value => ({...value, entries: value.entries.includes(href) ? value.entries.filter(item => item !== href) : [...value.entries, href]}));
  }
  function renderEntry(entry: AdminNavEntry) {
    const isCurrent = current?.entry.href === entry.href;
    return entry.children?.length
      ? <NavBranch key={entry.href} entry={entry} currentHref={currentHref} currentEntry={isCurrent} open={open.entries.includes(entry.href)} pinned={pins.includes(entry.href)} onToggleOpen={() => toggleEntry(entry.href)} onTogglePin={onTogglePin} onNavigate={onNavigate} />
      : <NavLinkRow key={entry.href} entry={entry} active={isCurrent} pinned={pins.includes(entry.href)} onTogglePin={onTogglePin} onNavigate={onNavigate} />;
  }

  if (rail) {
    const rest = groups.flatMap(group => group.entries).filter(entry => !pinnedHrefs.has(entry.href));
    const railLink = (entry: AdminNavEntry) => {
      const Icon = ICONS[entry.icon]; const active = current?.entry.href === entry.href;
      return <Link key={entry.href} href={entry.href} onClick={onNavigate} title={entry.label} aria-label={entry.label} aria-current={active ? 'page' : undefined} className={cn(
        'flex min-h-11 items-center justify-center rounded-lg transition-colors',
        active ? 'admin-nav-active bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}><Icon className="h-4 w-4" /></Link>;
    };
    return <nav aria-label="后台导航" className="space-y-0.5">
      {pinned.length > 0 && <><p className="px-1 pb-1 text-center text-[10px] leading-4 text-muted-foreground">常用</p>{pinned.map(railLink)}<span aria-hidden className="my-1 block h-px bg-border" /></>}
      {rest.map(railLink)}
    </nav>;
  }

  return <nav aria-label="后台导航" className="space-y-2">
    {pinNotice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-foreground">{pinNotice}</p>}
    {pinned.length > 0 && <section aria-label="常用入口" className="border-b border-border pb-2">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">常用</p>
      <div className="space-y-0.5">{pinned.map(renderEntry)}</div>
    </section>}
    {groups.map(group => {
      const entries = group.entries.filter(entry => !pinnedHrefs.has(entry.href));
      if (!entries.length) return null;
      const groupOpen = open.groups.includes(group.id);
      return <div key={group.id}>
        <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={groupOpen} className="admin-nav-group flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <span className="flex min-w-0 items-center gap-2"><span className="truncate">{group.label}</span><span className="text-[10px] opacity-60">{entries.length}</span></span>
          {groupOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        </button>
        {groupOpen && <div className="mt-1 space-y-0.5">{entries.map(renderEntry)}</div>}
      </div>;
    })}
  </nav>;
}
