import type {WorkbenchMetric} from './types';

const integer = new Intl.NumberFormat('zh-CN');

/** 数字或明确的「算不出来」；未知值永远不写成 0。 */
export function metricText(metric: WorkbenchMetric): string {
  if (metric.value === null) return metric.unavailableReason ?? '暂无数据';
  return integer.format(metric.value);
}

export function cnyText(metric: WorkbenchMetric): string {
  if (metric.value === null) return metric.unavailableReason ?? '暂无数据';
  return `¥${metric.value.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

export function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
