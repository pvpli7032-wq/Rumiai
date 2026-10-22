import type {AiStreamMetrics} from '@/lib/ai/types';
import {aiErrorCode, aiUserError, type PromptCharacter} from '@/lib/conversations/chat-stream';
import {MirrorError} from './errors';
import {clampLine, cleanLine, readIndex} from './text';
import type {MirrorCharacterOption, MirrorResultFields, MirrorRules} from './types';

/**
 * 他眼中的你：提示词、结构校验与一次格式修复。
 *
 * 生成只有一次真实调用；模型输出不符合结构时，用同一份回答再做一次「只修格式」的
 * 调用（最多一次），仍不合格就明确失败。所有供应商调用都在调用方通过
 * runtime-service 的模型计划发起，这里不直接拼供应商请求。
 */

export const MIRROR_TASK_TYPE = 'mirror';

/**
 * 结构不合格或输入不合法时统一抛这个。继承 MirrorError，
 * 路由的同一套错误映射就能给出正确的状态码（400 输入、502 结构）。
 */
export class MirrorGenerationError extends MirrorError {
  constructor(message: string, code: string, status = 502) {
    super(message, status, code);
    this.name = 'MirrorGenerationError';
  }
}

/** 发给模型的纪律：只产出 JSON，不解释、不寒暄、不编造新信息。 */
const OUTPUT_CONTRACT = [
  '只输出一个 JSON 对象，不要代码块、不要解释、不要多余文字。',
  'JSON 结构：{"title": 字符串, "observations": [字符串, 字符串, 字符串], "quote": 字符串, "indices": {"atmosphere": 0-100 的整数, "rapport": 0-100 的整数}}。',
  'observations 恰好三条，每条是一句独立观察，不是回答的复述。',
].join('\n');

/** 生成提示词：设置中心的模板 + 角色身份 + 字数上限 + 用户回答。 */
export function buildMirrorPrompt(input: {
  template: string;
  character: Pick<MirrorCharacterOption, 'name' | 'tagline'> & Partial<PromptCharacter>;
  answers: string[];
  rules: Pick<MirrorRules, 'answerMaxChars' | 'titleMaxChars' | 'observationMaxChars' | 'quoteMaxChars'>;
}): string {
  const {template, character, answers, rules} = input;
  const identity = [
    `角色：${character.name}`,
    character.tagline?.trim() ? `一句话简介：${character.tagline.trim()}` : null,
    character.personality?.trim() ? `性格：${character.personality.trim()}` : null,
    character.background?.trim() ? `背景：${character.background.trim()}` : null,
    character.scenario?.trim() ? `场景：${character.scenario.trim()}` : null,
  ].filter((line): line is string => Boolean(line));
  const questions = answers.map((answer, index) => `第${index + 1}题回答：${answer}`).join('\n');
  return [
    template.trim(),
    identity.join('\n'),
    [
      `称号不超过 ${rules.titleMaxChars} 字；`,
      `三条观察每条不超过 ${rules.observationMaxChars} 字；`,
      `金句不超过 ${rules.quoteMaxChars} 字；`,
      '两个指数都是 0 到 100 的整数。',
      '站在这个角色的视角写，口吻与角色一致；可以锐利、可以有玩笑，但不做人身攻击，不编造回答里没有的事实。',
    ].join('\n'),
    questions,
    OUTPUT_CONTRACT,
  ].join('\n\n');
}

/**
 * 结构校验失败后的修复提示词：把上一次的原样输出交给模型改格式，
 * 不允许它借修复重写内容。
 */
export function buildRepairPrompt(input: {raw: string; answers: string[]; rules: MirrorRules}): string {
  return [
    '下面这段内容本应是约定结构的 JSON，但格式不符合要求。',
    '只修正格式：补齐或删减 observations 到恰好三条、指数改成 0 到 100 的整数、去掉代码块与多余文字；内容保持原意，不要新增事实。',
    OUTPUT_CONTRACT,
    `用户原回答（仅供核对措辞，不要复述）：\n${input.answers.join('\n')}`,
    `待修正内容：\n${input.raw}`,
  ].join('\n\n');
}

/** 去掉模型偶尔套上的 ```json 包裹，再截取最外层对象。 */
function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

const charCount = (value: string) => [...value].length;

export type MirrorValidation =
  | {ok: true; fields: MirrorResultFields}
  | {ok: false; reason: string};

/**
 * 结构校验：字段齐全、三条观察、两个指数都是 0–100 的整数。
 *
 * 称号/观察/金句允许按上限截断（模型偶尔多写几个字），但缺字段、条数不对、
 * 指数不是数字都属于结构问题，必须走修复或失败，不在这里悄悄补默认值。
 */
export function validateMirrorOutput(raw: string, limits: {titleMaxChars: number; observationMaxChars: number; quoteMaxChars: number}): MirrorValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch {
    return {ok: false, reason: 'JSON 无法解析'};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {ok: false, reason: '顶层不是对象'};
  const data = parsed as Record<string, unknown>;
  const title = cleanLine(data.title);
  if (!title) return {ok: false, reason: '缺少称号'};
  if (!Array.isArray(data.observations)) return {ok: false, reason: '缺少观察列表'};
  const observations = data.observations.map(cleanLine);
  if (observations.length !== 3 || observations.some(item => !item)) return {ok: false, reason: '观察必须恰好三条'};
  const quote = cleanLine(data.quote);
  if (!quote) return {ok: false, reason: '缺少金句'};
  const indices = data.indices;
  if (!indices || typeof indices !== 'object' || Array.isArray(indices)) return {ok: false, reason: '缺少娱乐指数'};
  const atmosphere = readIndex((indices as Record<string, unknown>).atmosphere);
  const rapport = readIndex((indices as Record<string, unknown>).rapport);
  if (atmosphere === null || rapport === null) return {ok: false, reason: '娱乐指数不是整数'};
  const [first, second, third] = observations as [string, string, string];
  return {
    ok: true,
    fields: {
      title: clampLine(title, limits.titleMaxChars),
      observations: [clampLine(first, limits.observationMaxChars), clampLine(second, limits.observationMaxChars), clampLine(third, limits.observationMaxChars)],
      quote: clampLine(quote, limits.quoteMaxChars),
      indices: {atmosphere, rapport},
    },
  };
}

/** 回答长度校验：空白剥掉后 1 到 answerMaxChars 个字。 */
export function normalizeAnswers(input: unknown, rules: Pick<MirrorRules, 'questionCount' | 'answerMaxChars'>): string[] {
  if (!Array.isArray(input) || input.length !== rules.questionCount) {
    throw new MirrorGenerationError(`请按顺序回答 ${rules.questionCount} 道题。`, 'MIRROR_ANSWERS_INVALID', 400);
  }
  return input.map((item, index) => {
    if (typeof item !== 'string') throw new MirrorGenerationError(`第${index + 1}题的回答须为文字。`, 'MIRROR_ANSWERS_INVALID', 400);
    const text = item.replace(/\r\n/g, '\n').trim();
    if (!text) throw new MirrorGenerationError(`第${index + 1}题还没有回答。`, 'MIRROR_ANSWERS_INVALID', 400);
    if (charCount(text) > rules.answerMaxChars) throw new MirrorGenerationError(`第${index + 1}题的回答超过 ${rules.answerMaxChars} 字。`, 'MIRROR_ANSWERS_INVALID', 400);
    return text;
  });
}

export type MirrorModelCall = (prompt: string) => Promise<{text: string; metrics: AiStreamMetrics}>;

export type MirrorGenerateOutcome = {
  fields: MirrorResultFields;
  raw: string;
  /** 实际发生的供应商调用次数：1 或 2（第二次是格式修复）。 */
  attempts: number;
  repairUsed: boolean;
  metrics: AiStreamMetrics;
};

/**
 * 一次生成 + 至多一次格式修复。
 *
 * 修复调用失败或修复后仍不合格都明确失败：抛 MirrorGenerationError，
 * 由路由把本次占用的额度退回，并给用户可读的失败文案。
 */
export async function generateMirrorResult(input: {
  call: MirrorModelCall;
  prompt: string;
  repairPrompt: (raw: string) => string;
  limits: {titleMaxChars: number; observationMaxChars: number; quoteMaxChars: number};
}): Promise<MirrorGenerateOutcome> {
  const first = await runModel(input.call, input.prompt);
  const firstCheck = validateMirrorOutput(first.text, input.limits);
  if (firstCheck.ok) return {fields: firstCheck.fields, raw: first.text, attempts: 1, repairUsed: false, metrics: first.metrics};

  let repaired: Awaited<ReturnType<MirrorModelCall>>;
  try {
    repaired = await runModel(input.call, input.repairPrompt(first.text));
  } catch (error) {
    throw new MirrorGenerationError(aiUserError(error), aiErrorCode(error) === 'UPSTREAM_ERROR' ? 'MIRROR_REPAIR_FAILED' : aiErrorCode(error));
  }
  const secondCheck = validateMirrorOutput(repaired.text, input.limits);
  if (!secondCheck.ok) throw new MirrorGenerationError('这次没能生成合格的结果，请稍后重试。', 'MIRROR_STRUCTURE_INVALID');
  return {fields: secondCheck.fields, raw: repaired.text, attempts: 2, repairUsed: true, metrics: repaired.metrics};
}

async function runModel(call: MirrorModelCall, prompt: string) {
  try {
    return await call(prompt);
  } catch (error) {
    if (error instanceof MirrorGenerationError) throw error;
    throw new MirrorGenerationError(aiUserError(error), aiErrorCode(error) === 'UPSTREAM_ERROR' ? 'UPSTREAM_ERROR' : aiErrorCode(error));
  }
}
