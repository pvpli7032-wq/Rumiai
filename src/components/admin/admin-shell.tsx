'use client';
import {useEffect, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {
  Activity, ArrowLeft, BarChart3, Bot, ChevronDown, ChevronRight, ClipboardList, Coins, Cpu,
  FileText, Gift, KeyRound, Landmark, LayoutDashboard, LayoutTemplate, Menu, MessageSquare,
  ScrollText, ShieldCheck, UserCog, Users, Wallet, X, type LucideIcon,
} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from './use-admin-access';
import {findEntry, visibleGroups, type AdminNavIcon} from '@/lib/admin/nav';

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
};

export function AdminShell({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const {user} = useAuth();
  const {permissions} = useAdminAccess();
  const groups = visibleGroups(permissions);
  const current = findEntry(pathname, permissions);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [drawer, setDrawer] = useState(false);

  // The group holding the current page is expanded by default; the operator's own
  // toggles are layered on top of that.
  useEffect(() => {
    if (!current) return;
    setOpenGroups(list => (list.includes(current.group.id) ? list : [...list, current.group.id]));
  }, [current?.group.id]);

  useEffect(() => { setDrawer(false); }, [pathname]);

  function isOpen(id: string) {
    return openGroups.includes(id) || current?.group.id === id;
  }
  function toggle(id: string) {
    setOpenGroups(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]));
  }

  function navigation(onNavigate?: () => void) {
    return (
      <nav aria-label="后台导航" className="space-y-1">
        {groups.map(group => {
          const open = isOpen(group.id);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span>{group.label}</span>
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {open && (
                <div className="mt-1 space-y-1">
                  {group.entries.map(({href, label, icon}) => {
                    const Icon = ICONS[icon];
                    const active = pathname === href || pathname.startsWith(href + '/');
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    );
  }

  const breadcrumb = (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Link href="/admin" className="hidden text-muted-foreground hover:text-foreground sm:inline">管理中心</Link>
      {current && <><ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" /><span className="hidden shrink-0 text-muted-foreground sm:inline">{current.group.label}</span></>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-semibold">{current?.entry.label ?? '管理后台'}</span>
    </div>
  );

  return (
    <div style={{height: 'var(--app-height, 100dvh)'}} className="flex min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <Link href="/admin" className="flex h-20 items-center gap-3 border-b border-border px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-brand-foreground"><ShieldCheck className="h-5 w-5" /></span>
          <span><span className="block text-lg font-bold tracking-tight">星伴管理中心</span><span className="text-xs text-muted-foreground">运营控制台</span></span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{navigation()}</div>
        <Link href="/profile" className="m-4 flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm hover:bg-accent"><ArrowLeft className="h-4 w-4" />返回网站</Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="打开后台菜单"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            {breadcrumb}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="max-w-32 truncate text-sm font-medium">{user?.username ?? '未登录'}</span>
            <Link href="/profile" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent lg:hidden">返回网站</Link>
          </div>
        </header>
        <div role="region" aria-label="后台工作区" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 [&>main]:mx-auto [&>main]:w-full [&>main]:max-w-[1440px] [&>main]:p-0">{children}</div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="后台菜单" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <span className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-brand" />星伴管理中心</span>
              <button type="button" onClick={() => setDrawer(false)} aria-label="关闭后台菜单" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{navigation(() => setDrawer(false))}</div>
            <Link href="/profile" className="m-3 flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm"><ArrowLeft className="h-4 w-4" />返回网站</Link>
          </div>
        </div>
      )}
    </div>
  );
}
