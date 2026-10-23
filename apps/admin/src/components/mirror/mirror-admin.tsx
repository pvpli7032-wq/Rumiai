'use client';

import {RefreshCw} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@admin/components/admin-page';
import {DataTable} from '@admin/components/layout/data-table';
import {FilterBar} from '@admin/components/layout/filter-bar';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Select} from '@rumiai/ui/select';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@rumiai/ui/tabs';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {MirrorConfigPanel} from './mirror-config-panel';
import {MirrorStatsPanel} from './mirror-stats-panel';
import {MirrorResultDrawer} from './mirror-result-drawer';
import {
  MIRROR_STATUS_FILTERS,
  MIRROR_STATUS_LABELS,
  MIRROR_STATUS_VARIANTS,
  formatDateTime,
  type MirrorConfigPayload,
  type MirrorResultItem,
  type MirrorResultPage,
  type MirrorStatus,
} from './types';

const PAGE_LIMIT = 20;

/**
 * 「他眼中的你」后台三个标签（V3 §23 表 19）：结果 / 配置 / 统计。
 *
 * 生成成功率只由「统计」标签给出，口径来自运营分析的 ops-metrics（生成完成人数 /
 * 开始答题人数）。这里不再按最近若干条结果另算一份比例——两处各算各的，数字迟早对不上。
 * 本页只保留两个与「已加载列表」直接相关的计数：已加载条数与其中失败条数。
 *
 * 隐藏是把状态置 HIDDEN（分享码失效、记录保留对账），因此动作只出现在结果详情里，
 * 列表每行只保留「查看详情」。
 */
export function MirrorAdmin() {
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('mirror.read');
  const canManage = permissions.includes('mirror.manage');

  const [tab, setTab] = useState<'results' | 'config' | 'stats'>('results');
  const [status, setStatus] = useState<MirrorStatus | 'ALL'>('ALL');
  const [page, setPage] = useState<MirrorResultPage | null>(null);
  const [config, setConfig] = useState<MirrorConfigPayload | null>(null);
  const [configError, setConfigError] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<MirrorResultItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadList = useCallback(async (cursor: string | null, append: boolean) => {
    if (!sessionActive) return;
    setLoadingList(true);
    setError('');
    try {
      const query = new URLSearchParams({limit: String(PAGE_LIMIT)});
      if (status !== 'ALL') query.set('status', status);
      if (cursor) query.set('cursor', cursor);
      const data = await apiFetch<MirrorResultPage>(API.admin.mirrorResults(query.toString()), {credentials: 'same-origin', cache: 'no-store'});
      setPage(current => (append && current ? {items: [...current.items, ...data.items], nextCursor: data.nextCursor} : data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '结果列表加载失败。');
    } finally {
      setLoadingList(false);
    }
  }, [sessionActive, status]);

  useEffect(() => {
    setPage(null);
    setSelected(null);
    setNotice('');
    if (sessionActive && canRead) void loadList(null, false);
  }, [sessionActive, canRead, status, refreshKey, loadList]);

  // 配置标签只读：角色候选、题目文本、示例结果与规则都来自公开初始化接口，编辑入口在设置中心与角色管理。
  useEffect(() => {
    if (!sessionActive || !canRead) return;
    const controller = new AbortController();
    setConfig(null);
    setConfigError('');
    void apiFetch<MirrorConfigPayload>(API.mirror.generate, {cache: 'no-store', signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        setConfig({
          characters: data.characters ?? [],
          rules: data.rules,
          questions: data.questions ?? [],
          examples: data.examples ?? [],
          exampleCount: data.exampleCount ?? 0,
        });
      })
      .catch(cause => { if (!controller.signal.aborted) setConfigError(cause instanceof Error ? cause.message : '配置读取失败。'); });
    return () => controller.abort();
  }, [sessionActive, canRead, refreshKey]);

  // 只统计「当前已加载的这一页」，与分页游标一致；比例类指标不在这里算。
  const loaded = useMemo(() => {
    if (!page) return null;
    return {total: page.items.length, failed: page.items.filter(item => item.status === 'FAILED').length};
  }, [page]);

  async function hideResult(item: MirrorResultItem) {
    if (!sessionActive || busy) return;
    if (!window.confirm(`隐藏结果 ${item.shareId}？分享码会立即失效，记录保留以便与费用单对账。`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.mirrorResult(item.id), {credentials: 'same-origin', method: 'DELETE'});
      setNotice(`结果 ${item.shareId} 已隐藏，分享页不再可访问。`);
      setSelected(null);
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '隐藏失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function restoreResult(item: MirrorResultItem) {
    if (!sessionActive || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await apiFetch<{status: MirrorStatus; changed: boolean}>(API.admin.mirrorResult(item.id), {credentials: 'same-origin', method: 'PATCH'});
      setNotice(
        data.changed
          ? `结果 ${item.shareId} 已恢复为「${MIRROR_STATUS_LABELS[data.status]}」。`
          : `结果 ${item.shareId} 当前是「${MIRROR_STATUS_LABELS[data.status]}」，不需要恢复。`,
      );
      setSelected(null);
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!sessionActive || !canRead) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有「他眼中的你」查看权限。'} /></AdminPage>;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="增长与玩法"
        title="他眼中的你"
        description="看结果、配置与统计；角色、题目、示例与版式只在设置中心和角色管理里改，同一项不设第二个编辑位置。"
        actions={<Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loadingList} onClick={() => setRefreshKey(value => value + 1)}>刷新</Button>}
        meta={<Badge variant="outline">成功率见「统计」标签</Badge>}
      />

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}

      <Tabs value={tab} onValueChange={value => setTab(value === 'config' ? 'config' : value === 'stats' ? 'stats' : 'results')}>
        <TabsList aria-label="他眼中的你视图">
          <TabsTrigger value="results">结果列表</TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
          <TabsTrigger value="stats">统计</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          <div className="flex flex-col gap-5">
            <AdminStatGrid className="xl:grid-cols-3">
              <AdminStat label="已加载结果" value={loaded ? String(loaded.total) : '—'} hint="后台接口按游标分页，这里只数已加载的这一页" />
              <AdminStat label="其中生成失败" value={loaded ? String(loaded.failed) : '—'} hint="状态为生成失败的结果，按条计数" tone={loaded && loaded.failed > 0 ? 'warning' : 'default'} />
              <AdminStat label="生成成功率" value="见统计标签" hint="口径：生成完成人数 / 开始答题人数，来自运营分析的 ops-metrics" />
            </AdminStatGrid>

            <AdminNotice
              tone="info"
              title="成功率只在「统计」标签给出"
              description="统计标签复用运营分析口径，与结果列表的条数不是一回事；这里不再按样本另算一份比例，避免两个数字对不上。"
              action={<Button variant="outline" size="sm" onClick={() => setTab('stats')}>去看统计</Button>}
            />

            <AdminPanel
              title="结果列表"
              description="按状态筛选；过期是按 expires_at 计算的展示判断，不改变保存的状态。"
              badge={page ? <Badge>{page.items.length} 条已加载</Badge> : undefined}
              flush
              bodyClassName="p-5"
            >
              <DataTable
                rows={page?.items ?? []}
                getRowId={item => item.id}
                loading={loadingList && !page}
                filters={
                  <FilterBar
                    onReset={() => setStatus('ALL')}
                    aria-label="结果筛选"
                  >
                    <div className="w-full sm:w-48">
                      <Select
                        aria-label="结果状态"
                        value={status}
                        onChange={event => setStatus(event.target.value as MirrorStatus | 'ALL')}
                      >
                        {MIRROR_STATUS_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </Select>
                    </div>
                  </FilterBar>
                }
                emptyTitle="没有匹配的结果"
                emptyDescription="换一个状态筛选，或等前台产生新的结果。"
                error={error || undefined}
                onRetry={() => setRefreshKey(value => value + 1)}
                columns={[
                  {
                    id: 'result',
                    header: '结果',
                    cell: item => (
                      <span className="block max-w-sm">
                        <span className="block break-words font-medium">{item.title}</span>
                        <span className="mt-0.5 block break-words text-xs text-muted-foreground">{item.quote}</span>
                      </span>
                    ),
                  },
                  {id: 'character', header: '角色', width: '140px', cell: item => <span className="break-words">{item.character?.name ?? '—'}</span>},
                  {id: 'author', header: '作者', width: '140px', cell: item => <span className="break-words">{item.anonymous ? '匿名访客' : item.author?.name ?? '已注销'}</span>},
                  {
                    id: 'status',
                    header: '状态',
                    width: '150px',
                    cell: item => (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={MIRROR_STATUS_VARIANTS[item.status]}>{MIRROR_STATUS_LABELS[item.status]}</Badge>
                        {item.expired && item.status !== 'EXPIRED' && <Badge variant="warning">已过期</Badge>}
                      </span>
                    ),
                  },
                  {id: 'created', header: '创建时间', width: '170px', cell: item => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>},
                  {id: 'expires', header: '过期时间', width: '170px', cell: item => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(item.expiresAt)}</span>},
                  {
                    id: 'actions',
                    header: '操作',
                    width: '110px',
                    cell: item => (
                      <Button size="sm" variant="outline" aria-label={`查看结果 ${item.shareId}`} onClick={() => { setSelected(item); setError(''); setNotice(''); }}>
                        查看详情
                      </Button>
                    ),
                  },
                ]}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {page?.nextCursor && (
                  <Button variant="outline" size="sm" loading={loadingList} onClick={() => void loadList(page.nextCursor, true)}>加载更多</Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {page ? (page.nextCursor ? '还有更多结果' : '已经到底了') : '正在读取结果…'}
                </span>
              </div>
            </AdminPanel>
          </div>
        </TabsContent>

        <TabsContent value="config">
          <MirrorConfigPanel config={config} error={configError} loading={!config && !configError} />
        </TabsContent>

        <TabsContent value="stats">
          <MirrorStatsPanel sessionActive={sessionActive} />
        </TabsContent>
      </Tabs>

      <MirrorResultDrawer
        item={selected}
        canManage={canManage}
        busy={busy}
        onClose={() => setSelected(null)}
        onHide={item => void hideResult(item)}
        onRestore={item => void restoreResult(item)}
      />
    </AdminPage>
  );
}
