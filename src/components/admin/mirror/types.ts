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
  /** 三条观察的写作风格说明（mirror.observationStyle），拼进提示词。 */
  observationStyle: string;
  /** 新结果使用的版式（mirror.resultLayout）。 */
  resultLayout: 'FOUR_SECTION' | 'HERO_QUOTE';
  timezone: string;
}

export const MIRROR_LAYOUT_LABELS: Record<MirrorRulesView['resultLayout'], string> = {
  FOUR_SECTION: '四段式：称号／观察／金句／指数',
  HERO_QUOTE: '金句优先：金句在最前，其余在下方',
};

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

/** 日期时间展示统一走 src/lib/format/date-time.ts，此处只做转发，不重复实现。 */
export {formatDateTime} from '@/lib/format/date-time';

/** 统计标签要看的三项指标，顺序固定；key 与运营分析 ops-metrics 的 ratio key 一一对应。 */
export const MIRROR_STATS_RATIOS: {key: string; label: string; missingReason: string}[] = [
  {key: 'mirrorSuccess', label: '生成成功率', missingReason: '运营统计没有返回这一项。'},
  {key: 'shareAfterComplete', label: '分享后的访问', missingReason: '运营统计没有返回这一项。'},
  {key: 'mirrorToChat', label: '转去聊天', missingReason: '转去聊天已在客户端埋点（mirror_to_chat），但运营统计口径里还没有这项比例；补进 ops-metrics 后这里会自动显示，本页不另写聚合。'},
];

/**
 * 把 ops-metrics 返回的指标对到固定槽位上：三项必看指标按固定顺序排，
 * 取不到的那一项保留槽位并带上「还没进口径」的说明——不能因为接口少给一项
 * 就让统计页悄悄少一格，也不能在这里补算一个数字。
 * 接口里新增的其他 mirror 指标排在后面，补指标不用改代码。
 */
export function mirrorStatsCards<T extends {key: string; label: string}>(
  ratios: T[],
  slots = MIRROR_STATS_RATIOS,
): Array<{slot: {key: string; label: string; missingReason: string}; metric: T | null}> {
  const fixed = slots.map(slot => ({slot, metric: ratios.find(item => item.key === slot.key) ?? null}));
  const extra = ratios
    .filter(item => item.key.startsWith('mirror') && !slots.some(slot => slot.key === item.key))
    .map(metric => ({slot: {key: metric.key, label: metric.label, missingReason: ''}, metric}));
  return fixed.concat(extra);
}

/** 公开分享页固定走默认语言前缀，与 middleware 的 /mirror 重定向一致。 */
export function mirrorSharePath(shareId: string): string {
  return `/zh/mirror/${encodeURIComponent(shareId)}`;
}
