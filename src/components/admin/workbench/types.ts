/**
 * 工作台的读模型。
 *
 * 数字或 null：null 表示「这项数据暂时算不出来」（没有权限、接口失败、尚未采集），
 * 界面必须写清楚原因，不能用 0 冒充未知（V3 §14）。
 */
export interface WorkbenchMetric {
  value: number | null;
  /** 数值口径说明，例如「按支付成功且未退款统计」。 */
  hint: string;
  unavailableReason?: string;
}

export interface TodoItem {
  id: 'characters' | 'reports' | 'refunds';
  label: string;
  count: number | null;
  href: string;
  description: string;
}

export interface SystemStatusItem {
  id: 'ai' | 'backup' | 'tasks';
  label: string;
  detail: string;
  tone: 'ok' | 'warning' | 'danger' | 'unknown';
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface WorkbenchData {
  range: number;
  generatedAt: string;
  newUsers: WorkbenchMetric;
  validReplies: WorkbenchMetric;
  paidAmountCnyCents: WorkbenchMetric;
  aiCost: WorkbenchMetric;
  /** 趋势图：每日有效回复量。 */
  trend: TrendPoint[];
  todos: TodoItem[];
  statuses: SystemStatusItem[];
}
