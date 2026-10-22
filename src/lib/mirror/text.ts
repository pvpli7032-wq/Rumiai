/**
 * Mirror 结果的文本规整：示例内容与真实生成共用一套。
 *
 * 示例（examples.ts）与真实生成（generation.ts）此前各写了一份 cleanLine / clampLine / readIndex，
 * 三份逐字相同。字数上限与指数范围是同一套展示规则，改口径必须同时改到示例和真实结果，
 * 所以只留这里一份。
 */

/** 压成一行并去掉首尾空白；空串按「没有这一项」处理。 */
export function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

/** 按字符数（不是 UTF-16 码元）计长度：emoji 与组合字都算一个字，与字数上限口径一致。 */
export function charCount(value: string): number {
  return [...value].length;
}

/** 超长截断到上限，不因此判整份结果失败——长度上限是展示规则，不是内容错误。 */
export function clampLine(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/** 0–100 的整数指数；其他取值一律视为无效。 */
export function readIndex(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}
