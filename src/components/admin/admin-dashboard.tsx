'use client';
import Link from 'next/link';
import {useAdminAccess} from './use-admin-access';
import {ArrowUpRight, CheckCircle2, ShieldCheck} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {visibleGroups} from '@/lib/admin/nav';

export function AdminDashboard() {
  const {user} = useAuth();
  const {token, permissions, loading, error} = useAdminAccess();
  if (loading) return <main className="p-4"><p role="status">正在读取管理权限…</p></main>;
  if (!token) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p>请登录管理员账号。</p><Link href="/login?next=%2Fadmin" className="inline-flex min-h-11 items-center rounded-lg border px-4">登录</Link></main>;
  if (error) return <main className="p-4"><p role="alert">{error}</p></main>;

  // The workbench shows every entry the caller may open, grouped the same way the
  // sidebar groups it. No separate permission table to keep in sync.
  const groups = visibleGroups(permissions).filter(group => group.entries.some(entry => entry.href !== '/admin'));
  if (groups.length === 0) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p role="alert">当前账号没有管理权限，请联系站点运营人员。</p><Link href="/profile" className="inline-flex min-h-11 items-center">返回我的</Link></main>;

  return <main className="mx-auto max-w-5xl space-y-8 p-4">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-brand">运营工作台</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">管理后台</h1>
        <p className="mt-2 text-sm text-muted-foreground">欢迎回来，{user?.username}。从这里进入各业务域。</p>
      </div>
      <span className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500"><CheckCircle2 className="h-4 w-4" />管理权限已验证</span>
    </div>
    {groups.map(group => (
      <section key={group.id} className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {group.entries.map(entry => (
            <Link key={entry.href} href={entry.href} className="group min-w-0 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand/50">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{entry.label}</h3>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{entry.description}</p>
            </Link>
          ))}
        </div>
      </section>
    ))}
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />指标看板见各业务域页面；此处只列你可访问的入口。</p>
  </main>;
}
