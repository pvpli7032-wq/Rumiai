'use client';

import {ArrowUpRight, EyeOff, RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {DataTable} from '@/components/admin/layout/data-table';
import {FilterBar} from '@/components/admin/layout/filter-bar';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {DisputeCaseDrawer} from './dispute-case-drawer';
import {DisputeRewardPanel} from './dispute-reward-panel';
import {
  DISPUTE_STATUS_FILTERS,
  DISPUTE_STATUS_LABELS,
  DISPUTE_STATUS_VARIANTS,
  describeDeadline,
  formatDateTime,
  type DisputeCaseItem,
  type DisputeCasePage,
  type DisputeStatus,
} from './types';

const PAGE_LIMIT = 20;

/**
 * 评理广场后台：状态、票数、截止时间与最近失败原因。
 *
 * 规则（结案时长、票数门槛、可改票次数、字数上限）只在设置中心编辑，
 * 这里给一个跳转，不在每行放参数输入框。
 */
export function DisputeAdmin() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('disputes.read');
  const canManage = permissions.includes('disputes.manage');
  const canReadSettings = permissions.includes('settings.read');

  const [status, setStatus] = useState<DisputeStatus | 'ALL'>('ALL');
  const [page, setPage] = useState<DisputeCasePage | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<DisputeCaseItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadList = useCallback(async (cursor: string | null, append: boolean) => {
    if (!token) return;
    setLoadingList(true);
    setError('');
    try {
      const query = new URLSearchParams({limit: String(PAGE_LIMIT)});
      if (status !== 'ALL') query.set('status', status);
      if (cursor) query.set('cursor', cursor);
      const data = await apiFetch<DisputeCasePage>(API.admin.disputeCases(query.toString()), {token, cache: 'no-store'});
      setPage(current => (append && current ? {items: [...current.items, ...data.items], nextCursor: data.nextCursor} : data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评理案例加载失败。');
    } finally {
      setLoadingList(false);
    }
  }, [token, status]);

  useEffect(() => {
    setPage(null);
    setSelected(null);
    setNotice('');
    if (token && canRead) void loadList(null, false);
  }, [token, canRead, status, refreshKey, loadList]);

  const stats = useMemo(() => {
    const items = page?.items ?? [];
    return {
      total: items.length,
      open: items.filter(item => item.status === 'OPEN').length,
      overdue: items.filter(item => item.overdue).length,
      failed: items.filter(item => Boolean(item.lastFailure)).length,
    };
  }, [page]);

  async function hideCase(item: DisputeCaseItem) {
    if (!token || busy) return;
    // 一次对话框同时确认动作与原因：隐藏必须留下原因，二次确认也在这里完成。
    const reason = window.prompt(`隐藏案例 ${item.id}？\n隐藏后停止公开访问、停止投票，也不再进入结案任务。请填写原因（1–300 字）：`, '');
    if (reason === null) return;
    if (!reason.trim()) { setError('隐藏需要填写原因。'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch<{caseId: string; hidden: boolean; alreadyHidden: boolean}>(
        API.admin.disputeCaseHide(item.id),
        {token, method: 'POST', body: {reason: reason.trim()}},
      );
      setNotice(result.alreadyHidden ? `案例 ${result.caseId} 之前已停止公开，这次隐藏已记录。` : `案例 ${result.caseId} 已隐藏。`);
      setSelected(null);
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '隐藏失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function closeCase(item: DisputeCaseItem) {
    if (!token || busy) return;
    if (!window.confirm(`立即结案案例 ${item.id}？不等截止时间与票数，仍会生成一次角色回应。`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch<{caseId: string; status: string; alreadyClosed: boolean}>(
        API.admin.disputeCaseClose(item.id),
        {token, method: 'POST'},
      );
      setNotice(result.alreadyClosed ? `案例 ${result.caseId} 已经结案，未重复生成回应。` : `案例 ${result.caseId} 已结案。`);
      setSelected(null);
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '结案失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!token || !canRead) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有评理广场查看权限。'} /></AdminPage>;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="内容与社区"
        title="评理广场"
        description="看案例状态、票数与截止时间；到期或票数先到的案例由后台任务结案，失败原因直接取自任务记录。"
        actions={
          <>
            <Link
              href="/admin/settings"
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              结案规则在设置中心
              <ArrowUpRight aria-hidden className="h-4 w-4" />
            </Link>
            <Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loadingList} onClick={() => setRefreshKey(value => value + 1)}>刷新</Button>
          </>
        }
      />

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}

      <AdminStatGrid className="xl:grid-cols-3">
        <AdminStat label="本页待结案" value={String(stats.open)} hint="状态为待结案，等待截止时间或票数先到" tone={stats.open > 0 ? 'brand' : 'default'} />
        <AdminStat label="本页已逾期" value={String(stats.overdue)} hint="已过截止时间但还没结案，最该先看" tone={stats.overdue > 0 ? 'warning' : 'default'} />
        <AdminStat label="本页有失败记录" value={String(stats.failed)} hint="后台任务最近一次结案失败，原因见详情" tone={stats.failed > 0 ? 'danger' : 'default'} />
      </AdminStatGrid>

      <AdminPanel
        title="案例列表"
        description="待结案按截止时间从近到远，其他状态按创建时间倒序。"
        badge={page ? <Badge>{page.items.length} 条已加载</Badge> : undefined}
        flush
        bodyClassName="p-5"
      >
        <DataTable
          rows={page?.items ?? []}
          getRowId={item => item.id}
          loading={loadingList && !page}
          filters={
            <FilterBar onReset={() => setStatus('ALL')} aria-label="案例筛选">
              <div className="w-full sm:w-48">
                <Select aria-label="案例状态" value={status} onChange={event => setStatus(event.target.value as DisputeStatus | 'ALL')}>
                  {DISPUTE_STATUS_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
            </FilterBar>
          }
          emptyTitle="没有匹配的案例"
          emptyDescription="换一个状态筛选，或等前台发起新的评理。"
          error={error || undefined}
          onRetry={() => setRefreshKey(value => value + 1)}
          columns={[
            {
              id: 'claim',
              header: '诉求',
              cell: item => (
                <span className="block max-w-sm">
                  <span className="block break-words font-medium">{item.claim}</span>
                  <span className="mt-0.5 block break-all text-xs text-muted-foreground">{item.id}</span>
                </span>
              ),
            },
            {
              id: 'status',
              header: '状态',
              width: '130px',
              cell: item => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={DISPUTE_STATUS_VARIANTS[item.status]}>{DISPUTE_STATUS_LABELS[item.status]}</Badge>
                  {item.hidden && <Badge variant="neutral">已隐藏</Badge>}
                  {item.overdue && <Badge variant="danger">逾期</Badge>}
                </span>
              ),
            },
            {id: 'votes', header: '票数', width: '90px', align: 'right', cell: item => <span className="tabular-nums">{item.voteCount}</span>},
            {
              id: 'deadline',
              header: '截止时间',
              width: '200px',
              cell: item => (
                <span className="block whitespace-nowrap text-xs">
                  <span className="block text-foreground">{formatDateTime(item.deadlineAt)}</span>
                  <span className="block text-muted-foreground">{describeDeadline(item.deadlineAt)}</span>
                </span>
              ),
            },
            {
              id: 'failure',
              header: '最近失败原因',
              width: '220px',
              cell: item => item.lastFailure
                ? (
                  <span className="block max-w-56">
                    <span className="block break-words text-xs text-destructive">{item.lastFailure.message}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">第 {item.lastFailure.attempts} 次 · {formatDateTime(item.lastFailure.at)}</span>
                  </span>
                )
                : <span className="text-xs text-muted-foreground">无</span>,
            },
            {id: 'author', header: '发起人', width: '130px', cell: item => <span className="break-words">{item.author?.name ?? '已注销'}</span>},
            {
              id: 'hiddenBy',
              header: '隐藏记录',
              width: '200px',
              cell: item => item.hidden
                ? (
                  <span className="block max-w-48">
                    <span className="block break-words text-xs text-foreground">{item.hidden.reason}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.hidden.actor?.name ?? '账号已注销'} · {formatDateTime(item.hidden.at)}</span>
                  </span>
                )
                : <span className="text-xs text-muted-foreground">无</span>,
            },
            {
              id: 'actions',
              header: '操作',
              width: '170px',
              cell: item => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" aria-label={`查看案例 ${item.id}`} onClick={() => { setSelected(item); setError(''); setNotice(''); }}>
                    查看详情
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`隐藏案例 ${item.id}`}
                    disabled={Boolean(item.hidden) || item.status === 'CLOSED' || item.status === 'CLOSING' || busy}
                    onClick={() => void hideCase(item)}
                  >
                    {item.hidden ? '已隐藏' : '隐藏'}
                  </Button>
                </span>
              ),
            },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {page?.nextCursor && <Button variant="outline" size="sm" loading={loadingList} onClick={() => void loadList(page.nextCursor, true)}>加载更多</Button>}
          <span className="text-xs text-muted-foreground">{page ? (page.nextCursor ? '还有更多案例' : '已经到底了') : '正在读取案例…'}</span>
        </div>
      </AdminPanel>

      <DisputeRewardPanel token={token} canReadSettings={canReadSettings} refreshKey={refreshKey} />

      <DisputeCaseDrawer item={selected} canManage={canManage} busy={busy} onClose={() => setSelected(null)} onCloseCase={item => void closeCase(item)} onHide={item => void hideCase(item)} />
    </AdminPage>
  );
}
