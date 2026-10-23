'use client';

import Link from 'next/link';
import {CalendarDays, RefreshCw} from 'lucide-react';
import {useEffect, useState} from 'react';
import {AdminNotice, AdminPage} from '@/components/admin/admin-page';
import {AdminPageHeader} from '@/components/admin/layout/admin-page-header';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {visibleEntries} from '@/lib/admin/nav';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {cn} from '@/components/ui/cn';
import {MetricCards} from './metric-cards';
import {RANGE_OPTIONS, type RangeDays} from './range';
import {SystemStatusPanel} from './system-status-panel';
import {TodoPanel} from './todo-panel';
import {TrendPanel} from './trend-panel';
import {useWorkbenchData} from './use-workbench-data';

/**
 * 工作台：回答「今天怎么样、接下来处理什么」（V3 §14）。
 *
 * 标题 + 日期范围 + 刷新；四指标；待办 2/3 与系统状态 1/3；下方最多一张趋势图。
 * 不再铺满所有后台入口卡片——入口由侧栏六组导航承担。
 */
export function Workbench() {
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const [range, setRange] = useState<RangeDays>(7);
  const {data, loading, error, refresh} = useWorkbenchData(sessionActive ?? undefined, permissions, range);

  // 刷新后给一次轻提示，让运营知道看到的是刚取回的数据。
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && data) setRefreshedAt(new Date(data.generatedAt).toLocaleString('zh-CN'));
  }, [loading, data]);

  if (accessLoading) {
    return (
      <AdminPage>
        <AdminNotice tone="loading" title="正在读取管理权限…" />
      </AdminPage>
    );
  }
  if (!sessionActive) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="工作台" title="管理中心" />
        <AdminNotice
          tone="warning"
          title="请先登录管理员账号"
          description="管理中心只对拥有管理身份的账号开放。"
          action={<Link href="/admin/login?next=%2Fadmin"><Button>前往登录</Button></Link>}
        />
      </AdminPage>
    );
  }
  if (accessError) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="工作台" title="管理中心" />
        <AdminNotice tone="error" title={accessError} />
      </AdminPage>
    );
  }

  // 一个业务栏目都看不到，说明这个账号只有管理身份、没有任何角色权限。
  if (visibleEntries(permissions).every(entry => entry.permission === null)) {
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

  return (
    <AdminPage>
      <AdminPageHeader
        title="管理中心"
        description="今天怎么样、接下来处理什么。指标点击可进入对应列表，列表会保留这里的日期范围。"
        meta={<Badge variant="brand">工作台</Badge>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="日期范围" className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {RANGE_OPTIONS.map(option => (
                <button
                  key={option.days}
                  type="button"
                  aria-pressed={range === option.days}
                  onClick={() => setRange(option.days)}
                  className={cn(
                    'min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    range === option.days ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={refresh} loading={loading} leadingIcon={<RefreshCw aria-hidden className="h-4 w-4" />}>
              刷新
            </Button>
          </div>
        }
      />

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays aria-hidden className="h-3.5 w-3.5" />
        {refreshedAt ? `数据截至 ${refreshedAt}` : '正在读取数据…'}
        <span aria-live="polite" className="sr-only">{loading ? '正在刷新' : '数据已更新'}</span>
      </p>

      {error && <AdminNotice tone="error" title={error} action={<Button variant="outline" onClick={refresh}>重试</Button>} />}

      {!error && !data && <AdminNotice tone="loading" title="正在读取工作台数据…" />}

      {!error && data && (
        <>
          <MetricCards data={data} range={range} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <TodoPanel items={data.todos} />
            </div>
            <div className="min-w-0">
              <SystemStatusPanel items={data.statuses} />
            </div>
          </div>
          <TrendPanel points={data.trend} />
        </>
      )}
    </AdminPage>
  );
}
