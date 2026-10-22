/**
 * 日期时间展示的唯一实现。
 *
 * 后台四个模块（价格与成本、评理、Mirror、后台任务）此前各写了一份逐字相同的
 * formatDateTime，前台十几个页面也各自调 toLocaleString('zh-CN')。口径一旦要改
 * （换时区、换格式、换空值占位），会漏改一半。这里收成一处。
 */

/** 空值与非日期一律显示破折号，不显示 Invalid Date。 */
export const EMPTY_DATE = '—';

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return EMPTY_DATE;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? EMPTY_DATE : date.toLocaleString('zh-CN', {hour12: false});
}
