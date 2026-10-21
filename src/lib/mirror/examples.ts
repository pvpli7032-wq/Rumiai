import type {MirrorExampleResult, MirrorExampleView, MirrorResultFields} from './types';

/**
 * 示例结果（V3 §23：上线内容先准备 6 个角色和每个角色的示例结果）。
 *
 * 示例是运营在设置中心 mirror.exampleResults 里准备的内容，不是用户生成的真实结果：
 * - 它没有 shareId，不落 MirrorResult 表，不进任何统计；
 * - 前台展示时一律带「示例」标记，不冒充真实结果；
 * - 结构与真实结果完全一致（称号、三条观察、金句、两个指数），
 *   所以它走同一套字数上限与校验，配错的内容直接丢掉而不是显示半截。
 */

const charCount = (value: string) => [...value].length;

function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

/** 与真实结果同一套长度规则：超长截断到设置的上限，不因为多写几个字丢掉整条示例。 */
function clampLine(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

function readIndex(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export type MirrorLengthLimits = {titleMaxChars: number; observationMaxChars: number; quoteMaxChars: number};

/**
 * 解析一条示例。字段缺失或类型不对就返回 null——运营配错一条不该影响其他角色，
 * 也不该让整个首页报错。
 */
function parseOne(value: unknown, limits: MirrorLengthLimits): MirrorExampleResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const characterId = cleanLine(item.characterId);
  const title = cleanLine(item.title);
  const quote = cleanLine(item.quote);
  if (!characterId || !title || !quote) return null;
  if (!Array.isArray(item.observations) || item.observations.length !== 3) return null;
  const observations = item.observations.map(cleanLine);
  if (observations.some(observation => !observation)) return null;
  const indexA = readIndex(item.indexA);
  const indexB = readIndex(item.indexB);
  if (indexA === null || indexB === null) return null;
  const [first, second, third] = observations as [string, string, string];
  return {
    characterId,
    title: clampLine(title, limits.titleMaxChars),
    observations: [clampLine(first, limits.observationMaxChars), clampLine(second, limits.observationMaxChars), clampLine(third, limits.observationMaxChars)],
    quote: clampLine(quote, limits.quoteMaxChars),
    indexA,
    indexB,
  };
}

/** 解析整份示例名单。同一个角色配了多条时取第一条：前台一个角色只展示一个示例。 */
export function parseMirrorExamples(value: unknown, limits: MirrorLengthLimits): MirrorExampleResult[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const parsed: MirrorExampleResult[] = [];
  for (const entry of value) {
    const one = parseOne(entry, limits);
    if (!one || seen.has(one.characterId)) continue;
    seen.add(one.characterId);
    parsed.push(one);
  }
  return parsed;
}

/** 题目文本：按顺序取前 questionCount 条，不够就有几条给几条，绝不自动补默认题。 */
export function parseMirrorQuestions(value: unknown, questionCount: number): string[] {
  if (!Array.isArray(value)) return [];
  const asked = Math.max(0, Math.trunc(questionCount));
  return value
    .map(cleanLine)
    .filter((item): item is string => Boolean(item))
    .slice(0, asked);
}

/** 缺几道题：题目条数不足时前台据此明确提示，而不是静默用默认题顶上。 */
export function missingQuestionCount(questions: string[], questionCount: number): number {
  return Math.max(0, Math.trunc(questionCount) - questions.length);
}

/** 转成前台视图：与真实结果同形，但没有 shareId，也不带任何回答。 */
export function toExampleView(example: MirrorExampleResult): MirrorExampleView {
  const fields: MirrorResultFields = {
    title: example.title,
    observations: example.observations,
    quote: example.quote,
    indices: {atmosphere: example.indexA, rapport: example.indexB},
  };
  return {...fields, characterId: example.characterId};
}

/** 取某个角色的示例；没配就返回 null，前台据此不展示示例区。 */
export function exampleForCharacter(examples: MirrorExampleResult[], characterId: string | null): MirrorExampleView | null {
  if (!characterId) return null;
  const found = examples.find(example => example.characterId === characterId);
  return found ? toExampleView(found) : null;
}
