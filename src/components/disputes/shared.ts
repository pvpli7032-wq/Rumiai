import type {DisputeCaseDetail, DisputeCaseSummary} from '@/lib/disputes/types';

/** 三种投票选择在前后台都只有一个来源。 */
export const CHOICE_OPTIONS = [
  {value: 'AUTHOR', label: '我更有理', hint: '发起人这段话更有道理'},
  {value: 'OTHER', label: 'TA 更有理', hint: '角色那一边更有道理'},
  {value: 'SPLIT', label: '各打五十大板', hint: '两边都有道理，也都有问题'},
] as const;

export const SORT_TABS = [
  {value: 'hot', label: '热门'},
  {value: 'latest', label: '最新'},
  {value: 'joined', label: '我参与的'},
] as const;

export const MAX_COMMENT_CHARS = 500;

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
}

export function remainingText(target: string, now = Date.now()) {
  const ms = Date.parse(target) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '已到结案时间';
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `还剩 ${hours} 小时` : `还剩 ${Math.max(1, Math.ceil(ms / 60_000))} 分钟`;
}

export function caseStateLabel(item: Pick<DisputeCaseSummary, 'closeStatus' | 'withdrawn'>) {
  if (item.withdrawn) return '已撤回';
  return item.closeStatus === 'CLOSED' ? '已结案' : item.closeStatus === 'CLOSING' ? '正在结案' : '投票中';
}

