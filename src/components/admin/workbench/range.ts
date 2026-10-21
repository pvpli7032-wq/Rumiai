/** 工作台日期范围：固定几档，指标、待办链接与趋势图共用同一个天数。 */
export const RANGE_OPTIONS = [
  {days: 1, label: '今天'},
  {days: 7, label: '最近 7 天'},
  {days: 30, label: '最近 30 天'},
] as const;

export type RangeDays = (typeof RANGE_OPTIONS)[number]['days'];
