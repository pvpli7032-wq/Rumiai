/**
 * 后台「他眼中的你」页面共用的类型、文案与格式化。
 *
 * 只放展示层需要的东西：字段名与 /api/admin/mirror/results 的返回保持一致，
 * 状态文案只有一份，表格、抽屉和统计卡都从这里取。
 */

export type MirrorStatus = 'READY' | 'FAILED' | 'HIDDEN' | 'EXPIRED';

export interface MirrorResultItem {
  id: string;
  shareId: string;
  status: MirrorStatus;
  title: string;
  quote: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  anonymous: boolean;
  author: {id: string; name: string} | null;
  character: {id: string; name: string} | null;
}

export interface MirrorResultPage {
  items: MirrorResultItem[];
  nextCursor: string | null;
}

/** GET /api/mirror 返回的规则视图：只读，编辑统一在设置中心。 */
export interface MirrorRulesView {
  enabled: boolean;
  questionCount: number;
  answerMaxChars: number;
  titleMaxChars: number;
  observationMaxChars: number;
  quoteMaxChars: number;
  compareLimit: number;
  resultRetentionDays: number;
  timezone: string;
}

export interface MirrorCharacterOption {
  id: string;
  name: string;
  avatarUrl: string | null;
  tagline: string | null;
}

export interface MirrorConfigPayload {
  characters: MirrorCharacterOption[];
  rules: MirrorRulesView;
}

export const MIRROR_STATUS_LABELS: Record<MirrorStatus, string> = {
  READY: '已生成',
  FAILED: '生成失败',
  HIDDEN: '已隐藏',
  EXPIRED: '已过期',
};

export const MIRROR_STATUS_VARIANTS: Record<MirrorStatus, 'success' | 'danger' | 'neutral' | 'warning'> = {
  READY: 'success',
  FAILED: 'danger',
  HIDDEN: 'neutral',
  EXPIRED: 'warning',
};

export const MIRROR_STATUS_FILTERS: {value: MirrorStatus | 'ALL'; label: string}[] = [
  {value: 'ALL', label: '全部状态'},
  {value: 'READY', label: '已生成'},
  {value: 'FAILED', label: '生成失败'},
  {value: 'HIDDEN', label: '已隐藏'},
  {value: 'EXPIRED', label: '已过期'},
];

/** 生成成功率的最小样本：低于这个数只显示「样本不足」，不拿两三条凑百分比。 */
export const MIRROR_RATE_MIN_SAMPLE = 10;

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', {hour12: false});
}

/** 公开分享页固定走默认语言前缀，与 middleware 的 /mirror 重定向一致。 */
export function mirrorSharePath(shareId: string): string {
  return `/zh/mirror/${encodeURIComponent(shareId)}`;
}
