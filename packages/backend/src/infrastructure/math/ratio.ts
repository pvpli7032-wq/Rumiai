/**
 * 比率的唯一实现。
 *
 * 运营指标（总览、场景漏斗、通知统计）此前三处各写了一份逐字相同的
 * `denominator > 0 ? numerator / denominator : null`。返回 null 而不是 0 或 NaN
 * 是刻意的：分母为 0 表示「没有样本」，前端据此显示「—」；写成 0 会被读成
 * 「转化率为 0%」，把没有样本误报成业务失败。
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
