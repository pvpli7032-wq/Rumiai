/** 工作台日期范围：固定几档，指标、待办链接与趋势图共用同一个天数。 */
export const RANGE_OPTIONS = [
  {days: 1, label: '今天'},
  {days: 7, label: '最近 7 天'},
  {days: 30, label: '最近 30 天'},
] as const;

export type RangeDays = (typeof RANGE_OPTIONS)[number]['days'];

/**
 * 把工作台天数换算成后台列表用的 UTC 日期区间（含今天共 days 天）。
 *
 * 与操作审计、用户列表、充值订单同一口径：from / until 都是 UTC 日，
 * 且都含 until 当天 —— 所以「最近 7 天」是 from=今天-6 天、until=今天。
 * 指标卡跳转时把这两个值带进列表 URL，列表打开即按同一段日期过滤。
 */
export function rangeToDayParams(days: RangeDays, now: Date = new Date()): {from: string; until: string} {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = (offset: number) => new Date(today + offset * 86_400_000).toISOString().slice(0, 10);
  return {from: day(-(days - 1)), until: day(0)};
}
