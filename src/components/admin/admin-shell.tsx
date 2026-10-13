'use client';
import type {ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {LayoutDashboard,ShieldCheck,Wallet,ArrowLeft,ChevronRight} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from './use-admin-access';

export function AdminShell({children}:{children:ReactNode}) {
  const pathname=usePathname(),{user}=useAuth(),{access}=useAdminAccess();
  const items=[{href:'/admin',label:'工作台',icon:LayoutDashboard},...(access?.moderation?[{href:'/moderation',label:'审核管理',icon:ShieldCheck}]:[]),...(access?.finance?[{href:'/finance',label:'财务管理',icon:Wallet}]:[])];
  const title=items.find(item=>item.href===pathname)?.label??'管理后台';
  function navigation(mobile=false){return <nav aria-label={mobile?'后台手机导航':'后台导航'} className={mobile?'flex min-w-0 gap-1':'space-y-1'}>{items.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${mobile?'min-w-0 flex-1 justify-center':''} ${pathname===href?'bg-orange-500/10 text-orange-500':'text-muted-foreground hover:bg-accent hover:text-foreground'}`}><Icon className="h-4 w-4 shrink-0"/><span>{label}</span></Link>)}</nav>;}
  return <div style={{height:'var(--app-height, 100dvh)'}} className="flex min-h-0 w-full overflow-hidden bg-background text-foreground">
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <Link href="/admin" className="flex h-20 items-center gap-3 border-b border-border px-6"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white"><ShieldCheck className="h-5 w-5"/></span><span><span className="block text-lg font-bold tracking-tight">星伴管理中心</span><span className="text-xs text-muted-foreground">运营控制台</span></span></Link>
      <div className="flex-1 px-4 py-6"><p className="mb-3 px-3 text-xs font-medium text-muted-foreground">运营管理</p>{navigation()}</div>
      <Link href="/profile" className="m-4 flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm hover:bg-accent"><ArrowLeft className="h-4 w-4"/>返回网站</Link>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2 text-sm"><span className="hidden text-muted-foreground sm:inline">管理中心</span><ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block"/><span className="truncate font-semibold">{title}</span></div>
        <div className="flex min-w-0 items-center gap-3"><span className="hidden rounded-full border border-border px-3 py-1 text-xs text-muted-foreground sm:block">{access?.moderation&&access?.finance?'审核与财务':access?.moderation?'内容审核':access?.finance?'财务管理':'权限验证'}</span><span className="max-w-32 truncate text-sm font-medium">{user?.username??'未登录'}</span><Link href="/profile" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent lg:hidden">返回网站</Link></div>
      </header>
      <div className="shrink-0 border-b border-border bg-card px-2 lg:hidden">{navigation(true)}</div>
      <div role="region" aria-label="后台工作区" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 [&>main]:mx-auto [&>main]:w-full [&>main]:max-w-[1440px] [&>main]:p-0">{children}</div>
    </div>
  </div>;
}
