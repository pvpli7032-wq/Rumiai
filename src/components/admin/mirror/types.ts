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

export type MirrorFeaturedSource = 'CONFIGURED' | 'AUTO';

export interface MirrorCharacterOption {
  id: string;
  name: string;
  avatarUrl: string | null;
  tagline: string | null;
  /** 后台指定（CONFIGURED）还是名单为空时自动选取（AUTO）。 */
  source: MirrorFeaturedSource;
}

export const MIRROR_SOURCE_LABELS: Record<MirrorFeaturedSource, string> = {
  CONFIGURED: '后台指定',
  AUTO: '自动选取',
};

/** 前台展示用的示例结果；后台只关心「配了几条、覆盖哪些角色」。 */
export interface MirrorExampleView {
  characterId: string;
  title: string;
  observations: string[];
  quote: string;
  indices: {atmosphere: number; rapport: number};
}

export interface MirrorConfigPayload {
  characters: MirrorCharacterOption[];
  rules: MirrorRulesView;
  questions: string[];
  examples: MirrorExampleView[];
  exampleCount: number;
}

/**
 * 题目与示例的配置状态：后台只读展示「配够了没有」，不在这里编辑。
 * 题目条数少于 questionCount 就是待配置——前台会明确提示，不会用默认题顶上。
 */
export function mirrorQuestionState(questions: string[], questionCount: number): {ok: boolean; label: string; detail: string} {
  const missing = Math.max(0, questionCount - questions.length);
  if (missing > 0) {
    return {ok: false, label: '待配置', detail: `需要 ${questionCount} 道，当前只有 ${questions.length} 道，缺 ${missing} 道；前台会提示待配置并暂停答题。`};
  }
  return {ok: true, label: '已配置', detail: `当前 ${questions.length} 道，按顺序取前 ${questionCount} 道提问。`};
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

/** 日期时间展示统一走 src/lib/format/date-time.ts，此处只做转发，不重复实现。 */
export {formatDateTime} from '@/lib/format/date-time';

/** 公开分享页固定走默认语言前缀，与 middleware 的 /mirror 重定向一致。 */
export function mirrorSharePath(shareId: string): string {
  return `/zh/mirror/${encodeURIComponent(shareId)}`;
}
