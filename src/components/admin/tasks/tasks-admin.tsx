'use client';

import {Play, RefreshCw} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {DataTable} from '@/components/admin/layout/data-table';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {TaskSettingsPanel} from './task-settings-panel';
import {
  TASK_SETTING_KEYS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  describeNextRun,
  formatDateTime,
  type TaskItem,
  type TaskListResponse,
  type TaskRunResult,
  type TaskSettingKey,
} from './types';

type SettingValueRow = {key: string; value: unknown};

/**
 * 后台任务：任务名称、启用状态、最近运行、结果与手动执行。
 *
 * 频率、批次与重试不在每行出现，收在「高级设置」里并指向设置中心；
 * 手动执行只处理当前已到期的行，不改任何开关。
 */
export function TasksAdmin() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('tasks.read');
  const canManage = permissions.includes('tasks.manage');
  const canReadSettings = permissions.includes('settings.read');

  const [items, setItems] = useState<TaskItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingValues, setSettingValues] = useState<Partial<Record<TaskSettingKey, unknown>> | null>(null);
  const [settingError, setSettingError] = useState('');
  const [settingLoading, setSettingLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<TaskListResponse>(API.admin.tasks, {token, cache: 'no-store'});
      setItems(data.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务列表加载失败。');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setItems(null);
    setNotice('');
    if (token && canRead) void load();
  }, [token, canRead, refreshKey, load]);

  useEffect(() => {
    if (!token || !canReadSettings) { setSettingValues(null); return; }
    const controller = new AbortController();
    setSettingLoading(true);
    setSettingError('');
    void apiFetch<{values: SettingValueRow[]}>(API.admin.settings + '?group=growth', {token, cache: 'no-store', signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        const picked: Partial<Record<TaskSettingKey, unknown>> = {};
        for (const key of TASK_SETTING_KEYS) {
          const row = data.values.find(item => item.key === key);
          if (row) picked[key] = row.value;
        }
        setSettingValues(picked);
      })
      .catch(cause => { if (!controller.signal.aborted) setSettingError(cause instanceof Error ? cause.message : '任务参数读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setSettingLoading(false); });
    return () => controller.abort();
  }, [token, canReadSettings, refreshKey]);

  const stats = useMemo(() => {
    const list = items ?? [];
    return {
      tasks: list.length,
      pending: list.reduce((sum, item) => sum + item.pending, 0),
      failed: list.reduce((sum, item) => sum + item.failed, 0),
      disabled: list.filter(item => !item.enabled).length,
    };
  }, [items]);

  async function runOnce(item: TaskItem) {
    if (!token || running) return;
    if (!window.confirm(`立即执行「${item.name}」？只处理当前已到期的任务，不修改开关。`)) return;
    setRunning(item.kind);
    setError('');
    setNotice('');
    try {
      // 手动执行接口是 POST /api/admin/tasks/{kind}/run，路径表只登记了列表地址。
      const result = await apiFetch<TaskRunResult>(`/api/admin/tasks/${encodeURIComponent(item.kind)}/run`, {token, method: 'POST'});
      const suffix = result.failed > 0 ? `，${result.failed} 个失败` : '';
      setNotice(`${item.name}：${result.detail}（完成 ${result.affected} 个${suffix}）`);
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务执行失败，请稍后重试。');
    } finally {
      setRunning(null);
    }
  }

  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!token || !canRead) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有后台任务查看权限。'} /></AdminPage>;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="系统设置"
        title="后台任务"
        description="剧情状态、记忆摘要、评理结案、Mirror 过期、计费核对、备份清理、每日备份与事件清理共用一个入口；到期由轮询执行，也可以手动跑一次。"
        actions={<Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>刷新</Button>}
      />

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}

      <AdminStatGrid>
        <AdminStat label="任务种类" value={String(stats.tasks)} hint="处理器在 src/lib/tasks/handlers.ts 唯一登记" />
        <AdminStat label="待处理" value={String(stats.pending)} hint="已入队、等待到期执行" tone={stats.pending > 0 ? 'brand' : 'default'} />
        <AdminStat label="已失败" value={String(stats.failed)} hint="超过重试上限后置为失败，需要人工看原因" tone={stats.failed > 0 ? 'danger' : 'default'} />
        <AdminStat label="受开关关闭" value={String(stats.disabled)} hint="依赖的功能开关关闭时任务不产生新工作" tone={stats.disabled > 0 ? 'warning' : 'default'} />
      </AdminStatGrid>

      <AdminPanel
        title="任务列表"
        description="最近运行取该种类最新更新的一条记录；结果展示最近状态、失败原因与下次运行时间。"
        badge={items ? <Badge>{items.length} 个任务</Badge> : undefined}
        flush
        bodyClassName="p-5"
      >
        <DataTable
          rows={items ?? []}
          getRowId={item => item.kind}
          loading={loading && !items}
          emptyTitle="没有可显示的后台任务"
          emptyDescription="处理器登记后这里会自动出现。"
          error={error || undefined}
          onRetry={() => setRefreshKey(value => value + 1)}
          columns={[
            {
              id: 'task',
              header: '任务',
              cell: item => (
                <span className="block max-w-sm">
                  <span className="block break-words font-medium">{item.name}</span>
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">{item.description}</span>
                  <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{item.kind}</span>
                </span>
              ),
            },
            {
              id: 'enabled',
              header: '启用状态',
              width: '150px',
              cell: item => (
                <span className="flex flex-col gap-1">
                  <Badge variant={item.enabled ? 'success' : 'neutral'}>{item.enabled ? '已启用' : '已关闭'}</Badge>
                  <span className="break-all text-xs text-muted-foreground">{item.switchKey ?? '无独立开关'}</span>
                </span>
              ),
            },
            {
              id: 'queue',
              header: '队列',
              width: '150px',
              cell: item => (
                <span className="block text-xs">
                  <span className="block">待处理 {item.pending} · 运行中 {item.running}</span>
                  <span className="block text-muted-foreground">完成 {item.done} · 失败 {item.failed}</span>
                </span>
              ),
            },
            {
              id: 'lastRun',
              header: '最近运行',
              width: '190px',
              cell: item => (
                <span className="block text-xs">
                  <span className="block whitespace-nowrap">{formatDateTime(item.lastRunAt)}</span>
                  <span className="mt-1 block">
                    {item.lastStatus ? (
                      <Badge variant={TASK_STATUS_VARIANTS[item.lastStatus] ?? 'neutral'}>{TASK_STATUS_LABELS[item.lastStatus] ?? item.lastStatus}</Badge>
                    ) : (
                      <span className="text-muted-foreground">还没运行过</span>
                    )}
                  </span>
                </span>
              ),
            },
            {
              id: 'result',
              header: '结果',
              width: '230px',
              cell: item => (
                <span className="block max-w-56 text-xs">
                  {item.lastError
                    ? <span className="block break-words text-destructive">{item.lastError}</span>
                    : <span className="block text-muted-foreground">最近没有失败记录</span>}
                  <span className="mt-1 block break-all text-muted-foreground">
                    下次：{item.nextRunAt ? `${formatDateTime(item.nextRunAt)}（${describeNextRun(item.nextRunAt)}）` : '无待执行记录'}
                  </span>
                </span>
              ),
            },
            {
              id: 'actions',
              header: '操作',
              width: '120px',
              cell: item => canManage ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`立即执行 ${item.name}`}
                  loading={running === item.kind}
                  disabled={!item.runnable || (running !== null && running !== item.kind)}
                  leadingIcon={<Play className="h-3.5 w-3.5" />}
                  onClick={() => void runOnce(item)}
                >
                  执行一次
                </Button>
              ) : <span className="text-xs text-muted-foreground">只读</span>,
            },
          ]}
        />
      </AdminPanel>

      <TaskSettingsPanel values={settingValues} canReadSettings={canReadSettings} error={settingError} loading={settingLoading} />
    </AdminPage>
  );
}
