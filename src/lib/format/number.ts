/**
 * 数字展示的唯一实现。
 *
 * 后台四个分析面板（运营指标、总览、玩法漏斗、场景漏斗）此前各写了一份逐字相同的
 * `const number = (value) => new Intl.NumberFormat('zh-CN').format(value)`。千分位口径
 * 只该有一处，否则改格式要挨个面板找。
 */

/** 1234567 -> "1,234,567"。整数计数用这个，不要各写一份 Intl。 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

/**
 * 分转元，统一两位小数：1234 -> "¥12.34"。
 *
 * 这个模板此前在后台财务四处各写一份（`¥${(cents / 100).toFixed(2)}`）。
 * 不用 Intl 的 currency 样式：它会给大额加千分位，和已上线的文案不一致。
 */
export function formatCny(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 比率转百分比，一位小数：0.1234 -> "12.3%"。
 *
 * 分母为 0 时上游给 null，这里显示「样本不足」而不是 0%——没数据不等于零。
 * 只收一位小数这一种口径；两位小数的（场景漏斗、支付校验）各有各的精度要求，仍用本地实现。
 */
export function formatPercent(rate: number | null): string {
  return rate === null ? '样本不足' : `${(rate * 100).toFixed(1)}%`;
}
