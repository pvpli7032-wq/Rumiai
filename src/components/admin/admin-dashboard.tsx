'use client';
import Link from 'next/link';
import {useAdminAccess} from './use-admin-access';

export function AdminDashboard() {
  const {token, access, loading, error} = useAdminAccess();
  if (loading) return <main className="p-4"><p role="status">正在读取管理权限…</p></main>;
  if (!token) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p>请登录管理员账号。</p><Link href="/login?next=%2Fadmin" className="inline-flex min-h-11 items-center rounded-lg border px-4">登录</Link></main>;
  if (error) return <main className="p-4"><p role="alert">{error}</p></main>;
  if (!access?.moderation && !access?.finance) return <main className="space-y-4 p-4"><h1 className="text-xl font-bold">管理后台</h1><p role="alert">当前账号没有管理权限，请联系站点运营人员。</p><Link href="/profile" className="inline-flex min-h-11 items-center">返回我的</Link></main>;
  return <main className="mx-auto max-w-4xl space-y-6 p-4">
    <div><h1 className="text-2xl font-bold">管理后台</h1><p className="mt-2 text-muted-foreground">选择需要处理的运营工作。</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      {access.moderation && <Link href="/moderation" className="min-h-28 space-y-2 rounded-xl border border-border p-4 hover:bg-accent"><h2 className="text-lg font-semibold">内容审核</h2><p className="text-sm text-muted-foreground">角色发布、举报处理、封禁、申诉和审核记录</p></Link>}
      {access.finance && <Link href="/finance" className="min-h-28 space-y-2 rounded-xl border border-border p-4 hover:bg-accent"><h2 className="text-lg font-semibold">财务与充值</h2><p className="text-sm text-muted-foreground">充值套餐、活动赠币、订单退款、对账和 AI 成本</p></Link>}
    </div>
    <Link href="/profile" className="inline-flex min-h-11 items-center">返回我的 →</Link>
  </main>;
}
