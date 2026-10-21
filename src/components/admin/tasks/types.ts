/**
 * 后台任务页面共用的类型、文案与格式化。
 *
 * 任务种类由 src/lib/tasks/handlers.ts 唯一登记；这里只映射展示文案，
 * 不维护第二份 kind → 处理器 的对应关系。
 */

export type TaskKind = 'story-state' | 'memory-summary' | 'dispute-close' | 'mirror-expire' | 'charge-recovery' | 'backup-cleanup';

export interface TaskItem {
  kind: TaskKind;
  name: string;
  description: string;
  enabled: boolean;
  switchKey: string | null;
  pending: number;
  running: number;
  failed: number;
  done: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSubjectId: string | null;
  nextRunAt: string | null;
  runnable: boolean;
}

export interface TaskListResponse {
  items: TaskItem[];
}

export interface TaskRunResult {
  kind: TaskKind;
  detail: string;
  affected: number;
  failed: number;
  finishedAt: string;
}

/** 任务运行参数只在设置中心编辑，这里读取当前值用于展示。 */
export const TASK_SETTING_KEYS = ['tasks.intervalMs', 'tasks.batchSize', 'tasks.maxAttempts', 'tasks.backupRetention'] as const;
export type TaskSettingKey = typeof TASK_SETTING_KEYS[number];

export const TASK_SETTING_LABELS: Record<TaskSettingKey, {label: string; unit: string}> = {
  'tasks.intervalMs': {label: '轮询间隔', unit: '毫秒'},
  'tasks.batchSize': {label: '每批处理数', unit: '个'},
  'tasks.maxAttempts': {label: '有限重试次数', unit: '次'},
  'tasks.backupRetention': {label: '备份保留份数', unit: '份'},
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  RUNNING: '运行中',
  DONE: '已完成',
  FAILED: '已失败',
};

export const TASK_STATUS_VARIANTS: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'brand'> = {
  PENDING: 'neutral',
  RUNNING: 'brand',
  DONE: 'success',
  FAILED: 'danger',
};

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', {hour12: false});
}

/** 「距下次运行」：把 next_run_at 读成人能直接判断的相对时间。 */
export function describeNextRun(nextRunAt: string | null, now = Date.now()): string {
  if (!nextRunAt) return '—';
  const target = new Date(nextRunAt).getTime();
  if (Number.isNaN(target)) return '—';
  const diffMinutes = Math.round((target - now) / 60000);
  if (diffMinutes <= 0) return '已到期，等待下一次轮询';
  return diffMinutes >= 60 ? `约 ${Math.round(diffMinutes / 60)} 小时后` : `约 ${diffMinutes} 分钟后`;
}
