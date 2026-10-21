'use client';

import {useCallback, useEffect, useState} from 'react';
import {API} from '@/lib/api-paths';
import type {AdminPermission} from '@/lib/admin/permissions';
import type {RangeDays} from './range';
import type {SystemStatusItem, TodoItem, TrendPoint, WorkbenchData, WorkbenchMetric} from './types';

/**
 * 工作台数据：并行读取运营分析、待办队列与系统状态。
 *
 * 每一项独立成败：某个接口没权限或失败时，只有它那一格显示「暂时算不出」，
 * 整页仍然可用。读不到的数字一律是 null，绝不填 0。
 */
export function useWorkbenchData(token: string | undefined, permissions: readonly AdminPermission[], days: RangeDays) {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const headers = {Authorization: `Bearer ${token}`};
    const has = (permission: AdminPermission) => permissions.includes(permission);

    async function getJson(url: string): Promise<unknown> {
      const response = await fetch(url, {headers, cache: 'no-store', signal: controller.signal});
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as {error?: string} | null)?.error || '数据读取失败。');
      return payload;
    }

    void (async () => {
      try {
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
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
        setData(buildWorkbenchData({days, since, analytics, characters, reports, refunds, operations, models, tasks, permissions}));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : '工作台数据读取失败，请稍后重试。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, permissions, days, refreshKey]);

  return {data, loading, error, refresh};
}

interface BuildInput {
  days: RangeDays;
  since: string;
  permissions: readonly AdminPermission[];
  analytics: unknown;
  characters: unknown;
  reports: unknown;
  refunds: unknown;
  operations: unknown;
  models: unknown;
  tasks: unknown;
}

const NO_PERMISSION = '当前账号没有查看这项数据的权限。';
const READ_FAILED = '数据读取失败，请刷新重试。';

/** 把几个接口的原始响应收敛成工作台读模型；纯函数，方便单独核对口径。 */
function buildWorkbenchData(input: BuildInput): WorkbenchData {
  const analytics = input.analytics as AnalyticsPayload | null;
  const operations = input.operations as OperationsPayload | null;
  const models = Array.isArray(input.models) ? input.models as ModelRow[] : null;
  const tasks = Array.isArray(input.tasks) ? input.tasks as TaskRow[] : null;

  const newUsers = analytics ? metric(analytics.users.registered, '统计窗口内新注册且未注销的账号。') : unavailable(input.permissions.includes('analytics.read'));
  const validReplies = analytics ? metric(analytics.engagement.assistantMessages, '已保存的 AI 回复条数；模型失败与占位回复不计入。') : unavailable(input.permissions.includes('analytics.read'));
  const paidAmount = analytics
    ? metric(analytics.payments.paidAmountCnyCents / 100, '支付成功且未退款的人民币金额；充值套餐配置不在本卡内修改。')
    : unavailable(input.permissions.includes('analytics.read'));

  const aiCost: WorkbenchMetric = !analytics
    ? unavailable(input.permissions.includes('analytics.read'))
    : aiCostMetric(analytics.aiCosts);

  return {
    range: input.days,
    generatedAt: analytics?.generatedAt ?? new Date().toISOString(),
    newUsers,
    validReplies,
    paidAmountCnyCents: paidAmount,
    aiCost,
    trend: analytics ? trendOf(analytics, input.days) : [],
    todos: todoItems(input),
    statuses: statusItems(operations, models, tasks, input.permissions.includes('tasks.read')),
  };
}

function metric(value: number, hint: string): WorkbenchMetric {
  return {value: Number.isFinite(value) ? value : null, hint};
}

function unavailable(hasPermission: boolean, reason?: string): WorkbenchMetric {
  return {value: null, hint: hasPermission ? READ_FAILED : NO_PERMISSION, unavailableReason: reason ?? (hasPermission ? READ_FAILED : NO_PERMISSION)};
}

interface AnalyticsPayload {
  generatedAt: string;
  users: {registered: number; active: number; payingUsers: number};
  engagement: {assistantMessages: number; userMessages: number};
  payments: {paidAmountCnyCents: number; completedRefunds: number; refundedAmountCnyCents: number};
  aiCosts: Array<{currency: string; calls: number; knownCostCalls: number; unknownCostCalls: number; estimatedCost: number; mockCalls: number}>;
}

/**
 * AI 成本：成本价未登记时调用会被计为「成本未知」。
 * 只要存在未知成本的调用，或者全部调用都没有成本价，就不把已知部分当作总成本，
 * 而是提示「待填写模型成本价」。
 */
function aiCostMetric(costs: AnalyticsPayload['aiCosts']): WorkbenchMetric {
  const real = costs.reduce((total, row) => total + row.calls - row.mockCalls, 0);
  if (real === 0) return {value: null, hint: '统计窗口内没有真实 AI 调用。', unavailableReason: '暂无数据'};
  const unknown = costs.reduce((total, row) => total + row.unknownCostCalls, 0);
  if (unknown > 0) {
    return {
      value: null,
      hint: `有 ${unknown} 次调用尚未登记模型成本价，不能给出总成本。`,
      unavailableReason: '待填写模型成本价',
    };
  }
  if (costs.length === 0) return {value: null, hint: '统计窗口内没有真实 AI 调用。', unavailableReason: '暂无数据'};
  if (costs.length > 1) {
    return {
      value: null,
      hint: costs.map(row => `${row.currency} ${row.estimatedCost.toFixed(4)}`).join(' · '),
      unavailableReason: '多币种，暂不折算',
    };
  }
  return {value: costs[0].estimatedCost, hint: `按 ${costs[0].currency} 的已登记成本价估算，仅统计成功调用。`};
}

/** 趋势图只画一条线：每日有效回复。没有逐日数据时返回空数组，界面写「暂无数据」。 */
function trendOf(analytics: AnalyticsPayload, days: number): TrendPoint[] {
  const rows = (analytics as AnalyticsPayload & {daily?: unknown}).daily;
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      const record = row as {date?: unknown; assistantMessages?: unknown; replies?: unknown};
      const date = typeof record.date === 'string' ? record.date : null;
      const value = typeof record.assistantMessages === 'number' ? record.assistantMessages : typeof record.replies === 'number' ? record.replies : null;
      return date && value !== null ? [{date, value}] : [];
    })
    .slice(-days);
}

function countOf(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === 'object') {
    const items = (payload as {items?: unknown}).items;
    if (Array.isArray(items)) return items.length;
  }
  // 接口形状变了也算「算不出来」，不能退回 0。
  return null;
}

function todoItems(input: BuildInput): TodoItem[] {
  const canModerate = input.permissions.includes('moderation.read');
  const canFinance = input.permissions.includes('finance.read');
  const pendingCharacters = Array.isArray(input.characters)
    ? (input.characters as Array<{reviewStatus?: string}>).filter(row => row.reviewStatus === 'PENDING').length
    : null;
  const refunds = Array.isArray(input.refunds)
    ? (input.refunds as Array<{status?: string}>).filter(row => row.status === 'REFUND_PENDING').length
    : null;

  return [
    {
      id: 'characters',
      label: '待审角色',
      count: canModerate ? pendingCharacters : null,
      href: '/admin/moderation',
      description: canModerate ? '申请公开、等待审核的角色。' : NO_PERMISSION,
    },
    {
      id: 'reports',
      label: '未处理举报',
      count: canModerate ? countOf(input.reports) : null,
      href: '/admin/moderation',
      description: canModerate ? '状态仍为待处理的举报。' : NO_PERMISSION,
    },
    {
      id: 'refunds',
      label: '待处理退款',
      count: canFinance ? refunds : null,
      href: '/admin/finance',
      description: canFinance ? '已受理、等待退款结果的订单。' : NO_PERMISSION,
    },
  ];
}

interface TaskRow {
  kind: string;
  name: string;
  enabled: boolean;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

interface ModelRow {
  id: string;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
}

interface OperationsPayload {
  backups: {singleFileBackups: number; stateBundles: number; newestAt: string | null};
  database: {connected: boolean};
  alerts: Array<{severity: string; title: string}>;
}

function statusItems(operations: OperationsPayload | null, models: ModelRow[] | null, tasks: TaskRow[] | null, canReadTasks: boolean): SystemStatusItem[] {
  const statuses: SystemStatusItem[] = [];

  if (models === null) {
    statuses.push({id: 'ai', label: 'AI 可用性', detail: '需要「查看 AI 模型」权限。', tone: 'unknown'});
  } else if (!models.length) {
    statuses.push({id: 'ai', label: 'AI 可用性', detail: '尚未登记模型，聊天无法生成。', tone: 'warning'});
  } else {
    const defaults = models.filter(model => model.isActive && model.isDefault);
    if (defaults.length !== 1) {
      statuses.push({id: 'ai', label: 'AI 可用性', detail: '启用模型中没有唯一的默认模型。', tone: 'warning'});
    } else {
      const model = defaults[0];
      const last = model.lastCheckStatus;
      statuses.push({
        id: 'ai',
        label: 'AI 可用性',
        detail: last === 'AVAILABLE'
          ? `默认模型 ${model.displayName} 最近一次检查可用。`
          : last === null
            ? `默认模型 ${model.displayName} 尚未做连通性检查。`
            : `默认模型 ${model.displayName} 最近一次检查结果：${CHECK_LABELS[last] ?? last}。`,
        tone: last === 'AVAILABLE' ? 'ok' : last === null ? 'unknown' : 'warning',
      });
    }
  }

  if (operations === null) {
    statuses.push({id: 'backup', label: '最近备份', detail: '需要「查看系统运行状态」权限。', tone: 'unknown'});
  } else {
    const backups = operations.backups;
    const total = backups.singleFileBackups + backups.stateBundles;
    const newest = backups.newestAt;
    const stale = newest ? Date.now() - Date.parse(newest) > 7 * 86_400_000 : true;
    statuses.push({
      id: 'backup',
      label: '最近备份',
      detail: total === 0
        ? '本机未发现备份文件。'
        : `最近备份 ${new Date(newest as string).toLocaleString('zh-CN')}，共 ${total} 份。`,
      tone: total === 0 ? 'danger' : stale ? 'warning' : 'ok',
    });
  }

  // 任务状态直接读后台任务接口：只报待处理与失败数，不在这里重算各域逻辑。
  if (tasks === null) {
    statuses.push({id: 'tasks', label: '任务状态', detail: canReadTasks ? '任务数据读取失败。' : '需要「查看后台任务」权限。', tone: 'unknown'});
  } else {
    const failed = tasks.reduce((sum, row) => sum + row.failed, 0);
    const pending = tasks.reduce((sum, row) => sum + row.pending, 0);
    const broken = tasks.filter(row => row.lastStatus === 'FAILED').map(row => row.name);
    const paused = tasks.filter(row => !row.enabled).map(row => row.name);
    statuses.push({
      id: 'tasks',
      label: '任务状态',
      detail: failed > 0
        ? `${failed} 次失败，待处理 ${pending} 项${broken.length ? '：' + broken.join('、') : ''}`
        : pending > 0
          ? `待处理 ${pending} 项，没有失败记录。`
          : paused.length ? `没有待处理任务；已关闭：${paused.join('、')}。` : '没有待处理任务，近期没有失败。',
      tone: failed > 0 ? 'danger' : pending > 0 || paused.length ? 'warning' : 'ok',
    });
  }

  return statuses;
}

const CHECK_LABELS: Record<string, string> = {
  AVAILABLE: '可用',
  UNAVAILABLE: '不可达',
  REJECTED: '密钥被拒绝',
  NOT_LISTED: '模型未在供应商列表',
};
