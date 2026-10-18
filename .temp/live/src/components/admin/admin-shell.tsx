'use client';
import type {ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {LayoutDashboard,ShieldCheck,Wallet,ArrowLeft,ChevronRight,Bot,Cpu,Landmark,BarChart3,Gift,Activity} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from './use-admin-access';

export function AdminShell({children}:{children:ReactNode}) {
  const pathname=usePathname(),{user}=useAuth(),{access}=useAdminAccess();
  const items=[{href:'/admin',label:'工作台',icon:LayoutDashboard},...(access?.moderation?[{href:'/moderation',label:'审核管理',icon:ShieldCheck}]:[]),...(access?.finance?[{href:'/finance',label:'财务管理',icon:Wallet}]:[]),...(access?.analytics?[{href:'/admin/analytics',label:'运营分析',icon:BarChart3}]:[]),...(access?.growth?[{href:'/admin/growth',label:'任务与奖励',icon:Gift}]:[]),...(access?.operations?[{href:'/admin/operations',label:'系统与运维',icon:Activity}]:[]),...(access?.compliance?[{href:'/admin/compliance',label:'注册合规',icon:ShieldCheck}]:[]),...(access?.paymentMerchants?[{href:'/admin/payments/merchants',label:'支付商户',icon:Landmark}]:[]),...(access?.characters?[{href:'/admin/characters',label:'角色管理',icon:ShieldCheck}]:[]),...(access?.community?[{href:'/admin/circles',label:'圈子与成员',icon:ShieldCheck},{href:'/admin/community/posts',label:'帖子管理',icon:ShieldCheck},{href:'/admin/community/comments',label:'评论管理',icon:ShieldCheck}]:[]),...(access?.siteContent?[{href:'/admin/site-content',label:'站点内容',icon:LayoutDashboard}]:[]),...(access?.aiProviders?[{href:'/admin/ai/providers',label:'AI 供应商',icon:Bot}]:[]),...(access?.aiModels?[{href:'/admin/ai/models',label:'AI 模型与路由',icon:Cpu}]:[]),...(access?.aiCosts?[{href:'/admin/ai/costs',label:'AI 成本与预算',icon:Cpu}]:[]),...(access?.accounts?[{href:'/admin/accounts',label:'用户管理',icon:ShieldCheck}]:[]),...(access?.staff?[{href:'/admin/operators',label:'权限管理',icon:ShieldCheck}]:[]),...(access?.audit?[{href:'/admin/audit',label:'管理审计',icon:LayoutDashboard}]:[])];
  const title=items.find(item=>item.href===pathname)?.label??'管理后台';
  function navigation(mobile=false){return <nav aria-label={mobile?'后台手机导航':'后台导航'} className={mobile?'flex min-w-0 gap-1 overflow-x-auto':'space-y-1'}>{items.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${mobile?'shrink-0 justify-center':''} ${pathname===href?'bg-orange-500/10 text-orange-500':'text-muted-foreground hover:bg-accent hover:text-foreground'}`}><Icon className="h-4 w-4 shrink-0"/><span>{label}</span></Link>)}</nav>;}
  return <div style={{height:'var(--app-height, 100dvh)'}} className="flex min-h-0 w-full overflow-hidden bg-background text-foreground">
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <Link href="/admin" className="flex h-20 items-center gap-3 border-b border-border px-6"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white"><ShieldCheck className="h-5 w-5"/></span><span><span className="block text-lg font-bold tracking-tight">星伴管理中心</span><span className="text-xs text-muted-foreground">运营控制台</span></span></Link>
      <div className="flex-1 px-4 py-6"><p className="mb-3 px-3 text-xs font-medium text-muted-foreground">运营管理</p>{navigation()}</div>
      <Link href="/profile" className="m-4 flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm hover:bg-accent"><ArrowLeft className="h-4 w-4"/>返回网站</Link>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2 text-sm"><span className="hidden text-muted-foreground sm:inline">管理中心</span><ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block"/><span className="truncate font-semibold">{title}</span></div>
        <div className="flex min-w-0 items-center gap-3"><span className="hidden rounded-full border border-border px-3 py-1 text-xs text-muted-foreground sm:block">{access?.moderation&&access?.finance?'审核与财务':access?.moderation?'内容审核':access?.finance?'财务管理':access?.analytics?'运营分析':access?.growth?'任务与奖励':access?.operations?'系统与运维':access?.characters?'角色管理':access?.community?'社区管理':access?.siteContent?'站点内容':access?.accounts?'用户管理':access?.staff?'权限管理':access?.audit?'管理审计':'权限验证'}</span><span className="max-w-32 truncate text-sm font-medium">{user?.username??'未登录'}</span><Link href="/profile" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent lg:hidden">返回网站</Link></div>
      </header>
      <div className="shrink-0 border-b border-border bg-card px-2 lg:hidden">{navigation(true)}</div>
      <div role="region" aria-label="后台工作区" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 [&>main]:mx-auto [&>main]:w-full [&>main]:max-w-[1440px] [&>main]:p-0">{children}</div>
    </div>
  </div>;
}
