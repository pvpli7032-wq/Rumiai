/**
 * 后台评理广场页面共用的类型、状态文案与格式化。
 *
 * 字段与 /api/admin/disputes/cases 的返回一一对应；规则参数不在前端复制一份，
 * 需要看规则时跳设置中心。
 */

export type DisputeStatus = 'OPEN' | 'CLOSING' | 'CLOSED' | 'WITHDRAWN';

export interface DisputeFailure {
  message: string;
  at: string;
  attempts: number;
}

export interface DisputeCaseItem {
  id: string;
  postId: string;
  claim: string;
  status: DisputeStatus;
  voteCount: number;
  deadlineAt: string;
  createdAt: string;
  closedAt: string | null;
  overdue: boolean;
  author: {id: string; name: string} | null;
  character: {id: string; name: string} | null;
  lastFailure: DisputeFailure | null;
}

export interface DisputeCasePage {
  items: DisputeCaseItem[];
  nextCursor: string | null;
}

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: '待结案',
  CLOSING: '结案中',
  CLOSED: '已结案',
  WITHDRAWN: '已撤回',
};

export const DISPUTE_STATUS_VARIANTS: Record<DisputeStatus, 'success' | 'danger' | 'neutral' | 'warning' | 'brand'> = {
  OPEN: 'brand',
  CLOSING: 'warning',
  CLOSED: 'success',
  WITHDRAWN: 'neutral',
};

export const DISPUTE_STATUS_FILTERS: {value: DisputeStatus | 'ALL'; label: string}[] = [
  {value: 'ALL', label: '全部状态'},
  {value: 'OPEN', label: '待结案'},
  {value: 'CLOSING', label: '结案中'},
  {value: 'CLOSED', label: '已结案'},
  {value: 'WITHDRAWN', label: '已撤回'},
];

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', {hour12: false});
}

/** 距离截止还剩多久；已过期返回负数的可读描述，交给调用方决定样式。 */
export function describeDeadline(deadlineAt: string, now = Date.now()): string {
  const target = new Date(deadlineAt).getTime();
  if (Number.isNaN(target)) return '—';
  const diffMinutes = Math.round((target - now) / 60000);
  const abs = Math.abs(diffMinutes);
  const text = abs >= 1440 ? `${Math.floor(abs / 1440)} 天 ${Math.floor((abs % 1440) / 60)} 小时` : abs >= 60 ? `${Math.floor(abs / 60)} 小时 ${abs % 60} 分钟` : `${abs} 分钟`;
  return diffMinutes >= 0 ? `还剩 ${text}` : `已逾期 ${text}`;
}

export function disputePostPath(id: string): string {
  return `/zh/disputes/${encodeURIComponent(id)}`;
}
