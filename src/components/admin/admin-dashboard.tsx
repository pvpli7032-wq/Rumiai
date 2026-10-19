'use client';
import Link from 'next/link';
import {ArrowUpRight, Bot, CheckCircle2, Cpu, Landmark, ShieldCheck, Users} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from './admin-page';
import {useAdminAccess} from './use-admin-access';
import {visibleGroups, type AdminNavIcon} from '@/lib/admin/nav';

const GROUP_ICONS: Partial<Record<AdminNavIcon, typeof Users>> = {
  dashboard: ShieldCheck,
  characters: Users,
  accounts: Users,
  'ai-providers': Bot,
  'ai-models': Cpu,
  merchants: Landmark,
};

export function AdminDashboard() {
  const {user} = useAuth();
  const {token, permissions, session, loading, error} = useAdminAccess();

  if (loading) {
    return (
      <AdminPage>
        <AdminNotice tone="loading" title="正在读取管理权限…" />
      </AdminPage>
    );
  }
  if (!token) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="工作台" title="管理中心" />
        <AdminNotice
          tone="warning"
          title="请先登录管理员账号"
          description="管理中心只对拥有管理身份的账号开放。"
          action={<Link href="/login?next=%2Fadmin"><Button>前往登录</Button></Link>}
        />
      </AdminPage>
    );
  }
  if (error) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="工作台" title="管理中心" />
        <AdminNotice tone="error" title={error} />
      </AdminPage>
    );
  }

  // The workbench shows every entry the caller may open, grouped the same way the
  // sidebar groups it. No separate permission table to keep in sync.
  const groups = visibleGroups(permissions).filter(group => group.entries.some(entry => entry.href !== '/admin'));
  if (groups.length === 0) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="工作台" title="管理中心" />
        <AdminNotice
          tone="denied"
          title="当前账号没有管理权限"
          description="请联系站点运营人员为你分配管理身份与角色。"
          action={<Link href="/profile"><Button variant="outline">返回我的</Button></Link>}
        />
      </AdminPage>
    );
  }

  const roleLabel = session?.owner ? '站点所有者' : session?.managed ? '管理员' : session?.enabled ? '运营人员' : '受限账号';
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="工作台"
        title="管理中心"
        description={`欢迎回来，${user?.username ?? '运营人员'}。你在 ${groups.length} 个业务域下共有 ${entryCount} 个可访问栏目。`}
        meta={
          <Badge variant="success">
            <CheckCircle2 className="h-3.5 w-3.5" />{roleLabel}
          </Badge>
        }
      />

      {groups.map(group => (
        <AdminPanel
          key={group.id}
          title={group.label}
          description={group.id === 'workbench' ? undefined : `${group.entries.length} 个栏目`}
          badge={<Badge variant="neutral">{group.entries.length}</Badge>}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.entries.map(entry => {
              const Icon = GROUP_ICONS[entry.icon] ?? ShieldCheck;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className="group flex min-w-0 items-start gap-3 rounded-lg border border-border p-4 transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
                >
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{entry.label}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{entry.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </AdminPanel>
      ))}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />指标看板在各业务域页面；此处只列你可访问的入口。
      </p>
    </AdminPage>
  );
}
