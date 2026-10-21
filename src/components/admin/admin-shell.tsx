'use client';
import {useCallback, useEffect, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {
  ArrowLeft, ChevronDown, ChevronRight, ExternalLink, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, UserCog, X,
} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from './use-admin-access';
import {findEntry, visibleGroups} from '@/lib/admin/nav';
import {cn} from '@/components/ui/cn';
import {AdminNav} from './layout/admin-nav';
import {useNavPins} from './nav-pins';

const SIDEBAR_STATE_KEY = 'admin.sidebar.collapsed';

export function AdminShell({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const {user, logout} = useAuth();
  const {permissions, session} = useAdminAccess();
  const groups = visibleGroups(permissions);
  const current = findEntry(pathname, permissions);
  const {pins, notice: pinNotice, toggle: togglePin} = useNavPins(user?.id ?? null);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);

  // 侧栏折叠状态记在本地，刷新后保持；首次渲染统一展开，避免服务端/客户端不一致。
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_STATE_KEY) === '1') setCollapsed(true);
    } catch {
      /* 隐私模式下读不到就算了，按展开处理。 */
    }
  }, []);

  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);

  const closeMenu = useCallback(() => setMenu(false), []);
  useEffect(() => {
    if (!menu) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setMenu(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  function toggleSidebar() {
    setCollapsed(value => {
      try { window.localStorage.setItem(SIDEBAR_STATE_KEY, value ? '0' : '1'); } catch { /* 忽略写入失败 */ }
      return !value;
    });
  }

  const initial = (user?.username ?? '管').trim().charAt(0).toUpperCase();
  const roleLabel = session?.owner ? '站点所有者' : session?.managed ? '管理员' : session?.enabled ? '运营人员' : '未登录';

  const brand = (
    <Link
      href="/admin"
      className={cn(
        'flex h-16 shrink-0 items-center border-b border-border',
        collapsed ? 'justify-center px-2' : 'gap-3 px-5',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-brand-foreground">
        <ShieldCheck className="h-5 w-5" />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight">星伴管理中心</span>
          <span className="block truncate text-xs text-muted-foreground">运营控制台</span>
        </span>
      )}
    </Link>
  );

  return (
    <div style={{height: 'var(--app-height, 100dvh)'}} className="flex min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className={cn('hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        {brand}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <AdminNav
            pathname={pathname}
            groups={groups}
            permissions={permissions}
            pins={pins}
            onTogglePin={togglePin}
            pinNotice={pinNotice}
            rail={collapsed}
          />
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <Link
            href="/profile"
            title="返回站点"
            className={cn('mb-1 flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', collapsed && 'justify-center px-0')}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {!collapsed && <span>返回站点</span>}
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            className={cn('flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
            {!collapsed && <span>收起侧栏</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="打开后台菜单"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <nav aria-label="当前位置" className="flex min-w-0 items-center gap-2 text-sm">
              <Link href="/admin" className="hidden shrink-0 text-muted-foreground transition-colors hover:text-foreground sm:inline">管理中心</Link>
              {current && (
                <>
                  <ChevronRight aria-hidden className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">{current.group.label}</span>
                </>
              )}
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold text-foreground">{current?.entry.label ?? '管理后台'}</span>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
            >
              <ExternalLink className="h-4 w-4" />查看前台
            </Link>
            <span aria-hidden className="hidden h-6 w-px bg-border md:block" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu(value => !value)}
                aria-haspopup="menu"
                aria-expanded={menu}
                className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                  {initial}
                </span>
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block max-w-32 truncate font-medium leading-tight">{user?.username ?? '未登录'}</span>
                  <span className="block text-xs leading-tight text-muted-foreground">{roleLabel}</span>
                </span>
                <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden />
                  <div role="menu" aria-label="账号菜单" className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
                    <div className="border-b border-border px-4 py-3">
                      <p className="truncate text-sm font-medium">{user?.username ?? '未登录'}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email ?? '—'}</p>
                      <p className="mt-2 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{roleLabel}</p>
                    </div>
                    <Link role="menuitem" href="/profile" onClick={closeMenu} className="flex min-h-10 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent">
                      <UserCog className="h-4 w-4" />个人主页
                    </Link>
                    <Link role="menuitem" href="/profile" onClick={closeMenu} className="flex min-h-10 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent lg:hidden">
                      <ArrowLeft className="h-4 w-4" />返回站点
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenu(false); logout(); }}
                      className="flex min-h-10 w-full items-center gap-2 border-t border-border px-4 text-sm text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <LogOut className="h-4 w-4" />退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div role="region" aria-label="后台工作区" className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/40 [&>main]:mx-auto [&>main]:w-full [&>main]:max-w-[1440px] [&>main]:p-0">
          {children}
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="后台菜单" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
              <Link href="/admin" onClick={() => setDrawer(false)} className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-brand-foreground"><ShieldCheck className="h-4 w-4" /></span>
                <span className="text-sm font-semibold">星伴管理中心</span>
              </Link>
              <button type="button" onClick={() => setDrawer(false)} aria-label="关闭后台菜单" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <AdminNav
                pathname={pathname}
                groups={groups}
                permissions={permissions}
                pins={pins}
                onTogglePin={togglePin}
                pinNotice={pinNotice}
                onNavigate={() => setDrawer(false)}
              />
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <Link href="/profile" className="mb-1 flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm"><ArrowLeft className="h-4 w-4" />返回站点</Link>
              <button type="button" onClick={() => { setDrawer(false); logout(); }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-destructive"><LogOut className="h-4 w-4" />退出登录</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
