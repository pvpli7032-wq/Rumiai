'use client';
import Link from 'next/link';
import {useAdminAccess} from './use-admin-access';
import {ShieldCheck,Wallet,ArrowUpRight,CheckCircle2} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';

export function AdminDashboard() {
  const {user}=useAuth();
  const {token, access, loading, error} = useAdminAccess();
  if (loading) return <main className="p-4"><p role="status">正在读取管理权限…</p></main>;
  if (!token) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p>请登录管理员账号。</p><Link href="/login?next=%2Fadmin" className="inline-flex min-h-11 items-center rounded-lg border px-4">登录</Link></main>;
  if (error) return <main className="p-4"><p role="alert">{error}</p></main>;
  if (!access?.moderation && !access?.finance && !access?.staff && !access?.audit && !access?.accounts && !access?.characters && !access?.community) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p role="alert">当前账号没有管理权限，请联系站点运营人员。</p><Link href="/profile" className="inline-flex min-h-11 items-center">返回我的</Link></main>;
  return <main className="mx-auto max-w-4xl space-y-6 p-4">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-orange-500">运营工作台</p><h1 className="text-2xl font-bold tracking-tight md:text-3xl">管理后台</h1><p className="mt-2 text-sm text-muted-foreground">欢迎回来，{user?.username}。从这里处理内容与财务工作。</p></div><span className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500"><CheckCircle2 className="h-4 w-4"/>管理权限已验证</span></div>
    <div className="grid gap-4 sm:grid-cols-2">
      {access.moderation && <Link href="/moderation" className="group min-w-0 space-y-6 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-orange-500/50"><div className="flex items-center justify-between"><span className="rounded-xl bg-orange-500/10 p-3 text-orange-500"><ShieldCheck className="h-6 w-6"/></span><ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-orange-500"/></div><div><h2 className="text-xl font-semibold">内容审核</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">角色发布、举报处理、封禁、申诉和审核记录</p></div><p className="border-t border-border pt-4 text-sm font-medium">进入审核工作区 →</p></Link>}
      {access.finance && <Link href="/finance" className="group min-w-0 space-y-6 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-orange-500/50"><div className="flex items-center justify-between"><span className="rounded-xl bg-emerald-500/10 p-3 text-emerald-500"><Wallet className="h-6 w-6"/></span><ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-orange-500"/></div><div><h2 className="text-xl font-semibold">财务与充值</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">充值套餐、活动赠币、订单退款、对账和 AI 成本</p></div><p className="border-t border-border pt-4 text-sm font-medium">进入财务工作区 →</p></Link>}
    </div>
    {(access.staff || access.audit) && <section className="grid gap-4 sm:grid-cols-2">
      {access.staff && <Link href="/admin/operators" className="min-h-24 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">管理员与角色</h2><p className="mt-2 text-sm text-muted-foreground">管理身份、角色分配与操作权限</p></Link>}
      {access.audit && <Link href="/admin/audit" className="min-h-24 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">管理操作审计</h2><p className="mt-2 text-sm text-muted-foreground">查看权限变更、操作理由和记录</p></Link>}
    </section>}
    {access.characters && <Link href="/admin/characters" className="block min-h-24 rounded-xl border bg-card p-5"><h2 className="font-semibold">角色管理</h2><p className="mt-2 text-sm text-muted-foreground">全部状态、标签筛选、内容编辑、管理预览与发布</p></Link>}
    {access.community && <Link href="/admin/circles" className="block min-h-24 rounded-xl border bg-card p-5"><h2 className="font-semibold">圈子与成员</h2><p className="mt-2 text-sm text-muted-foreground">圈子内容、公开与推荐、成员及加入限制</p></Link>}
    {access.accounts && <Link href="/admin/accounts" className="block min-h-24 rounded-xl border bg-card p-5"><h2 className="font-semibold">用户管理</h2><p className="mt-2 text-sm text-muted-foreground">用户查询、账号停用、社区禁言及关联记录</p></Link>}
    <Link href="/profile" className="inline-flex min-h-11 items-center">返回我的 →</Link>
  </main>;
}
