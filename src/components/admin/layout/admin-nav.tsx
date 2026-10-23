'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {
  Activity, BarChart3, Bell, Bot, ChevronDown, ChevronRight, ClipboardList, Coins, Cpu, FileText, Gift, KeyRound,
  Landmark, LayoutDashboard, LayoutTemplate, MessageSquare, Pin, PinOff, RefreshCw, Scale, ScrollText, Settings,
  ShieldCheck, Sparkles, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import {findEntry, isEntryActive, type AdminNavEntry, type AdminNavGroup, type AdminNavIcon} from '@/lib/admin/nav';
import type {AdminPermission} from '@/lib/admin/permissions';
import {cn} from '@/components/ui/cn';
import {pinnedEntries} from '../nav-pins';

/** 导航图标只有这一处映射；新增入口时在 AdminNavIcon 与这里同步加一项。 */
const ICONS: Record<AdminNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  characters: Users,
  moderation: ShieldCheck,
  circles: UserCog,
  posts: FileText,
  comments: MessageSquare,
  accounts: UserCog,
  analytics: BarChart3,
  growth: Gift,
  'site-content': LayoutTemplate,
  finance: Wallet,
  merchants: Landmark,
  'ai-providers': Bot,
  'ai-models': Cpu,
  'ai-costs': Coins,
  operations: Activity,
  compliance: ScrollText,
  operators: KeyRound,
  audit: ClipboardList,
  mirror: Sparkles,
  disputes: Scale,
  tasks: RefreshCw,
  notifications: Bell,
  settings: Settings,
};

export interface AdminNavProps {
  pathname: string;
  /** 已经按权限裁剪过的分组。 */
  groups: AdminNavGroup[];
  permissions: readonly AdminPermission[];
  /** 本人置顶的 href，按置顶顺序。 */
  pins: readonly string[];
  onTogglePin: (entry: AdminNavEntry) => void;
  /** 置顶操作的一句回执；超过上限时是拒绝原因。 */
  pinNotice: string;
  /** 桌面收起态：只有图标，不分组也不写组名。 */
  rail?: boolean;
  onNavigate?: () => void;
}

/** 置顶/取消置顶小按钮。文字说明在 title 与 aria-label 上，视觉上只留图标。 */
function PinButton({entry, pinned, onToggle}: {entry: AdminNavEntry; pinned: boolean; onToggle: (entry: AdminNavEntry) => void}) {
  const Icon = pinned ? PinOff : Pin;
  const label = pinned ? `取消置顶「${entry.label}」` : `置顶「${entry.label}」`;
  return (
    <button
      type="button"
      onClick={() => onToggle(entry)}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pinned && 'text-brand hover:text-brand',
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

function NavRow({
  entry, active, pinned, onTogglePin, onNavigate,
}: {
  entry: AdminNavEntry;
  active: boolean;
  pinned: boolean;
  onTogglePin: (entry: AdminNavEntry) => void;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[entry.icon];
  return (
    <div className={cn('flex items-center gap-1 rounded-lg pr-1 transition-colors', active ? 'bg-brand-soft' : 'hover:bg-accent')}>
      <Link
        href={entry.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          active ? 'text-brand' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />}
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{entry.label}</span>
      </Link>
      <PinButton entry={entry} pinned={pinned} onToggle={onTogglePin} />
    </div>
  );
}

/**
 * 后台侧栏导航（V3 §13）：桌面展开态分六组、默认展开当前分组；顶部「常用」区
 * 最多 4 项，没有置顶时整块不渲染。收起成图标栏时把置顶项排在最前，后面接其余
 * 入口，避免同一入口在一列图标里出现两次。
 */
export function AdminNav({pathname, groups, permissions, pins, onTogglePin, pinNotice, rail = false, onNavigate}: AdminNavProps) {
  const current = findEntry(pathname, permissions);
  const [openGroups, setOpenGroups] = useState<string[]>(current ? [current.group.id] : []);

  // 当前页面所在分组默认展开，操作者自己的折叠在此基础上叠加。
  useEffect(() => {
    if (!current) return;
    setOpenGroups(list => (list.includes(current.group.id) ? list : [...list, current.group.id]));
  }, [current?.group.id]);

  const pinned = pinnedEntries(pins, permissions);
  const isActive = (href: string) => isEntryActive(pathname, href);

  if (rail) {
    const rest = groups.flatMap(group => group.entries).filter(entry => !pinned.some(item => item.href === entry.href));
    return (
      <nav aria-label="后台导航" className="space-y-0.5">
        {pinned.length > 0 && (
          <>
            <p className="px-1 pb-1 text-center text-[10px] leading-4 text-muted-foreground">常用</p>
            {pinned.map(entry => {
              const Icon = ICONS[entry.icon];
              const active = isActive(entry.href);
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  onClick={onNavigate}
                  title={entry.label}
                  aria-label={entry.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center justify-center rounded-lg transition-colors',
                    active ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
            <span aria-hidden className="my-1 block h-px bg-border" />
          </>
        )}
        {rest.map(entry => {
          const Icon = ICONS[entry.icon];
          const active = isActive(entry.href);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              onClick={onNavigate}
              title={entry.label}
              aria-label={entry.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center justify-center rounded-lg transition-colors',
                active ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="后台导航" className="space-y-1">
      {pinNotice && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-foreground">
          {pinNotice}
        </p>
      )}

      {pinned.length > 0 && (
        <section aria-label="常用入口" className="border-b border-border pb-2">
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">常用</p>
          <div className="space-y-0.5">
            {pinned.map(entry => (
              <NavRow key={entry.href} entry={entry} active={isActive(entry.href)} pinned onTogglePin={onTogglePin} onNavigate={onNavigate} />
            ))}
          </div>
        </section>
      )}

      {groups.map(group => {
        const open = openGroups.includes(group.id);
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => setOpenGroups(list => (list.includes(group.id) ? list.filter(item => item !== group.id) : [...list, group.id]))}
              aria-expanded={open}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="truncate">{group.label}</span>
              {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            </button>
            {open && (
              <div className="mt-1 space-y-0.5">
                {group.entries.map(entry => (
                  <NavRow
                    key={entry.href}
                    entry={entry}
                    active={isActive(entry.href)}
                    pinned={pins.includes(entry.href)}
                    onTogglePin={onTogglePin}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
