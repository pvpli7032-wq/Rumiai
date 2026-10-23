'use client';

import {useCallback, useEffect, useState} from 'react';
import {API} from '@/lib/api-paths';
import type {AdminPermission} from '@/lib/admin/permissions';
import type {RangeDays} from './range';
import type {WorkbenchData} from './types';
import {metricsOf} from './workbench-metrics';
import {statusItems} from './workbench-statuses';
import {todoItems} from './workbench-todos';

/**
 * 工作台数据：并行读取运营分析、待办队列与系统状态。
 *
 * 每一项独立成败：某个接口没权限或失败时，只有它那一格显示「暂时算不出」，
 * 整页仍然可用。读不到的数字一律是 null，绝不填 0。
 *
 * 本文件只做编排与返回结构；把原始响应收敛成读模型的三块分别在
 * workbench-metrics.ts（四张指标卡与趋势）、workbench-todos.ts（待办）、
 * workbench-statuses.ts（系统状态）。
 */
export function useWorkbenchData(sessionActive: boolean | undefined, permissions: readonly AdminPermission[], days: RangeDays) {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    if (!sessionActive) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const headers = undefined;
    const has = (permission: AdminPermission) => permissions.includes(permission);

    async function getJson(url: string): Promise<unknown> {
      const response = await fetch(url, {credentials: 'include', cache: 'no-store', signal: controller.signal});
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as {error?: string} | null)?.error || '数据读取失败。');
      return payload;
    }

    void (async () => {
      try {
        const [analytics, characters, reports, refunds, operations, models, tasks] = await Promise.all([
          has('analytics.read') ? getJson(`${API.admin.analytics}?days=${days}`) : Promise.resolve(null),
          has('moderation.read') ? getJson(API.admin.moderation.characters) : Promise.resolve(null),
          has('moderation.read') ? getJson(`${API.admin.moderation.reports}?status=OPEN&limit=50`) : Promise.resolve(null),
          has('finance.read') ? getJson(API.admin.finance.orders()) : Promise.resolve(null),
          has('operations.read') ? getJson(API.admin.operations) : Promise.resolve(null),
          has('ai.models.read') ? getJson(API.admin.ai.models) : Promise.resolve(null),
          has('tasks.read') ? getJson(API.admin.tasks) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        setData(buildWorkbenchData({days, analytics, characters, reports, refunds, operations, models, tasks, permissions}));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : '工作台数据读取失败，请稍后重试。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sessionActive, permissions, days, refreshKey]);

  return {data, loading, error, refresh};
}

interface BuildInput {
  days: RangeDays;
  permissions: readonly AdminPermission[];
  analytics: unknown;
  characters: unknown;
  reports: unknown;
  refunds: unknown;
  operations: unknown;
  models: unknown;
  tasks: unknown;
}

/** 把三块读模型拼成工作台数据；纯函数，方便单独核对口径。 */
function buildWorkbenchData(input: BuildInput): WorkbenchData {
  return {
    range: input.days,
    ...metricsOf(input.analytics, input.permissions, input.days),
    todos: todoItems(input),
    statuses: statusItems({
      operations: input.operations,
      models: input.models,
      tasks: input.tasks,
      canReadTasks: input.permissions.includes('tasks.read'),
    }),
  };
}
