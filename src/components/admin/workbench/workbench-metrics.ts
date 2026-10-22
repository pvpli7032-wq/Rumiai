import type {AdminPermission} from '@/lib/admin/permissions';
import type {RangeDays} from './range';
import type {TrendPoint, WorkbenchMetric} from './types';

/**
 * 指标格：把运营分析的原始响应收敛成四张指标卡 + 趋势图。
 *
 * 读不到的数字一律是 null，绝不填 0；每个 null 都带一句人能看懂的原因（V3 §14）。
 */

/** 没有权限与接口失败是两种不同的「算不出来」，文案不能混。待办也用这一句。 */
export const NO_PERMISSION = '当前账号没有查看这项数据的权限。';
const READ_FAILED = '数据读取失败，请刷新重试。';

/** 指标卡与趋势图这一整块的读模型。 */
export interface MetricsPanel {
  generatedAt: string;
  newUsers: WorkbenchMetric;
  validReplies: WorkbenchMetric;
  paidAmountCnyCents: WorkbenchMetric;
  aiCost: WorkbenchMetric;
  trend: TrendPoint[];
}

interface AnalyticsPayload {
  generatedAt: string;
  users: {registered: number; active: number; payingUsers: number};
  engagement: {assistantMessages: number; userMessages: number};
  payments: {paidAmountCnyCents: number; completedRefunds: number; refundedAmountCnyCents: number};
  aiCosts: Array<{currency: string; calls: number; knownCostCalls: number; unknownCostCalls: number; estimatedCost: number; mockCalls: number}>;
}

export function metricsOf(analytics: unknown, permissions: readonly AdminPermission[], days: RangeDays): MetricsPanel {
  const payload = analytics as AnalyticsPayload | null;
  const canRead = permissions.includes('analytics.read');
  return {
    generatedAt: payload?.generatedAt ?? new Date().toISOString(),
    newUsers: payload ? metric(payload.users.registered, '统计窗口内新注册且未注销的账号。') : unavailable(canRead),
    validReplies: payload ? metric(payload.engagement.assistantMessages, '已保存的 AI 回复条数；模型失败与占位回复不计入。') : unavailable(canRead),
    paidAmountCnyCents: payload
      ? metric(payload.payments.paidAmountCnyCents / 100, '支付成功且未退款的人民币金额；充值套餐配置不在本卡内修改。')
      : unavailable(canRead),
    aiCost: payload ? aiCostMetric(payload.aiCosts) : unavailable(canRead),
    trend: payload ? trendOf(payload, days) : [],
  };
}

function metric(value: number, hint: string): WorkbenchMetric {
  return {value: Number.isFinite(value) ? value : null, hint};
}

function unavailable(hasPermission: boolean, reason?: string): WorkbenchMetric {
  const text = hasPermission ? READ_FAILED : NO_PERMISSION;
  return {value: null, hint: text, unavailableReason: reason ?? text};
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
