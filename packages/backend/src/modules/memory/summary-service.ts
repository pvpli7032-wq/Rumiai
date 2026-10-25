import {db} from '@rumiai/backend/infrastructure/database/client';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {isAiChatAvailable} from '@rumiai/backend/infrastructure/config/launch-guards';
import {readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import {readActiveAiProviders} from '@rumiai/backend/modules/ai/providers/management-service';
import {reserveAiCall, finishAiCall, AiQuotaError} from '@rumiai/backend/modules/ai/ai-usage';
import type {AiStreamMetrics} from '@rumiai/backend/modules/ai/types';
import {streamOpenAIResponse} from '@rumiai/backend/modules/conversations/chat-stream';
import {proposeMemoryFact} from '@rumiai/backend/modules/memory/fact-service';
import {invalidateSummaryInTransaction} from '@rumiai/backend/modules/memory/invalidation';
import {MEMORY_SUMMARY_TASK, type MemorySettings, type MemorySummaryView} from '@rumiai/contracts/memory/types';

/**
 * 普通聊天的滚动摘要（V3 第 25 章）。
 *
 * - 只覆盖普通聊天：故事会话由 StoryCheckpoint 负责，这里直接跳过，不合并两条链。
 * - 达到 memory.summaryTriggerMessages 条新消息才登记一次持久任务；任务由统一后台入口
 *   执行，不在响应结束后靠裸 Promise。
 * - 关闭 memory.enabled 后既不生成也不再注入；摘要生成失败不让聊天失败，下一轮再处理。
 */

const MAX_TRANSCRIPT_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 400;
const TASK_LEASE_HINT = 'memory-summary';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

/** 记忆开关与各项参数每次都从设置中心读取，不导出成模块常量。 */
export async function readMemorySettings(userId?: string | null): Promise<MemorySettings> {
  const [enabled, trigger, maxChars, maxFacts, budget] = await Promise.all([
    readSettingValue<boolean>('memory.enabled', userId),
    readSettingValue<number>('memory.summaryTriggerMessages', userId),
    readSettingValue<number>('memory.summaryMaxChars', userId),
    readSettingValue<number>('memory.maxFacts', userId),
    readSettingValue<number>('memory.contextBudgetTokens', userId),
  ]);
  return {
    enabled: enabled === true,
    summaryTriggerMessages: clampInt(trigger, 4, 200, 20),
    summaryMaxChars: clampInt(maxChars, 100, 4000, 1000),
    maxFacts: clampInt(maxFacts, 0, 50, 10),
    contextBudgetTokens: clampInt(budget, 500, 64000, 8000),
  };
}

export async function readMemorySummary(conversationId: string): Promise<MemorySummaryView | null> {
  const row = await db.conversationMemory.findUnique({where: {conversationId}});
  if (!row) return null;
  return {summary: row.summary, coveredMessageId: row.coveredMessageId, version: row.version, updatedAt: row.updatedAt.toISOString()};
}

/** 摘要失效：整行删除，下次任务从剩余消息重新摘要，旧摘要不会被再次注入。 */
export async function invalidateMemorySummary(conversationId: string, reason: string): Promise<boolean> {
  return invalidateSummaryInTransaction(db, conversationId, reason);
}

/** 覆盖点之后的新消息；覆盖点本身已被删除时返回 null，调用方据此判定摘要失效。 */
async function readMessagesAfter(conversationId: string, coveredMessageId: string | null) {
  const covered = coveredMessageId
    ? await db.message.findUnique({where: {id: coveredMessageId}, select: {createdAt: true, id: true}})
    : null;
  if (coveredMessageId && !covered) return null;
  return db.message.findMany({
    where: {
      conversationId, contextIncluded: true,
      ...(covered
        ? {OR: [{createdAt: {gt: covered.createdAt}}, {createdAt: covered.createdAt, id: {gt: covered.id}}]}
        : {}),
    },
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    select: {id: true, role: true, content: true},
  });
}

/**
 * 登记一次摘要任务（幂等：唯一键 kind+subjectId）。关闭记忆时直接不登记，
 * 已有任务在任务处理器里也会被跳过。
 */
export async function enqueueMemorySummary(conversationId: string, options: {now?: Date} = {}): Promise<boolean> {
  const settings = await readMemorySettings();
  if (!settings.enabled) return false;
  const now = options.now ?? new Date();
  await db.backgroundTask.upsert({
    where: {kind_subjectId: {kind: MEMORY_SUMMARY_TASK, subjectId: conversationId}},
    create: {kind: MEMORY_SUMMARY_TASK, subjectId: conversationId, status: 'PENDING', attempts: 0, nextRunAt: now},
    update: {status: 'PENDING', nextRunAt: now},
  });
  return true;
}

/** 每条新回复之后调用：新消息累计到阈值才登记任务，避免每轮都建任务。 */
export async function enqueueSummaryIfDue(conversationId: string, options: {now?: Date} = {}): Promise<boolean> {
  const settings = await readMemorySettings();
  if (!settings.enabled) return false;
  const memory = await readMemorySummary(conversationId);
  const pending = await readMessagesAfter(conversationId, memory?.coveredMessageId ?? null);
  // 覆盖点消息已被删除：摘要过期，直接失效并重建。
  if (pending === null) {
    await invalidateMemorySummary(conversationId, 'COVERED_MESSAGE_MISSING');
    return enqueueMemorySummary(conversationId, options);
  }
  if (pending.length < settings.summaryTriggerMessages) return false;
  return enqueueMemorySummary(conversationId, options);
}

function buildSummaryPrompt(template: string, previous: string | null, transcript: Array<{role: string; content: string}>, maxChars: number): string {
  const lines = transcript.map(message => `${message.role === 'USER' ? '用户' : '角色'}：${message.content.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS)}`);
  return [
    template.trim(),
    previous ? `已有摘要（合并进去，不要重复罗列）：\n${previous}` : null,
    '只保留人物关系、约定与明确发生的事；不要编造，不要写建议或评价。',
    `用不超过 ${maxChars} 字的一段中文陈述，不要标题、列表或 Markdown。`,
    `待压缩的对话：\n${lines.join('\n')}`,
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}

/**
 * 从用户发言里挑出「可能在说自己的事」的候选事实（V3 §25）。
 *
 * 这是保守的规则抽取，不是理解：只认「我…」开头或含自我指向的短句，命中就交给用户确认，
 * 落 PENDING 不注入。宁可少提几条，也不把猜测写成确定记忆 —— 所以宁可漏，也不猜。
 */
const SELF_PATTERNS = ['我喜欢', '我不喜欢', '我讨厌', '我爱', '我住在', '我在', '我是', '我叫', '我养', '我有', '我怕', '我想', '我会', '我习惯', '我的'];
const MAX_CANDIDATES_PER_RUN = 3;
const MIN_FACT_CHARS = 6;
const MAX_FACT_CHARS = 60;
/** 扫描上限：只看最近这些消息、每条最多看这么多句、全程最多看这么多句，超了直接收工。 */
const SCAN_MAX_MESSAGES = MAX_TRANSCRIPT_MESSAGES;
const SCAN_MAX_SENTENCES_PER_MESSAGE = 40;
const SCAN_MAX_SENTENCES = 200;

function extractCandidateFacts(transcript: Array<{id: string; role: string; content: string}>): Array<{text: string; sourceMessageId: string}> {
  const found: Array<{text: string; sourceMessageId: string}> = [];
  const recent = transcript.slice(-SCAN_MAX_MESSAGES);
  let scanned = 0;
  for (const message of recent) {
    if (message.role !== 'USER') continue;
    // 先截断再切句：一条超长发言不会先被 split 成一堆碎片。
    const sentences = message.content.slice(0, MAX_MESSAGE_CHARS).split(/[。！？!?\n；;]/).slice(0, SCAN_MAX_SENTENCES_PER_MESSAGE);
    for (const raw of sentences) {
      scanned += 1;
      if (scanned > SCAN_MAX_SENTENCES) return found;
      const sentence = raw.replace(/\s+/g, ' ').trim();
      if (sentence.length < MIN_FACT_CHARS || sentence.length > MAX_FACT_CHARS) continue;
      if (!SELF_PATTERNS.some(pattern => sentence.startsWith(pattern) || sentence.includes(pattern))) continue;
      if (found.some(item => item.text === sentence)) continue;
      found.push({text: sentence, sourceMessageId: message.id});
      if (found.length >= MAX_CANDIDATES_PER_RUN) return found;
    }
  }
  return found;
}

/** 模拟环境：明确标注是模拟摘要，避免把占位文本当成真实记忆。 */
function mockSummary(count: number, maxChars: number): string {
  return `【模拟摘要】已根据最近 ${count} 条对话生成摘要（模拟环境，非真实模型摘要）。`.slice(0, maxChars);
}

async function summarizeWithModel(input: {conversationId: string; userId: string; characterId: string; prompt: string; maxChars: number}): Promise<{text: string; metrics: AiStreamMetrics}> {
  const plan = await readTaskModelPlan('memorySummary', {characterId: input.characterId});
  if (plan?.length === 0) throw new Error('NO_MODEL');
  const configured = plan === null ? await readActiveAiProviders() : [];
  const character = await db.character.findUnique({
    where: {id: input.characterId},
    select: {name: true, personality: true, background: true, scenario: true, roleTemplate: true, isAdult: true},
  });
  const persona = character ?? {name: '记录者', personality: '客观整理已发生的对话，不添加评论', background: null, scenario: null, roleTemplate: null, isAdult: false};
  const call = await reserveAiCall(input.userId, input.conversationId, 'MEMORY_SUMMARY', plan?.map(model => model.key), 'memorySummary');
  let metrics: AiStreamMetrics = {};
  try {
    const text = await streamOpenAIResponse({enqueue() {}} as unknown as ReadableStreamDefaultController, persona, [], input.prompt, null, {
      onMetrics(value) { metrics = value; },
      context: '这是普通聊天的记忆摘要，只输出一段中文摘要。',
      ...(plan && plan.length ? {models: plan, providers: plan.map(model => model.provider)} : {}),
      ...(configured.length ? {providers: configured} : {}),
    });
    await finishAiCall(call.id, call.startedAt, 'SUCCEEDED', metrics).catch(() => null);
    return {text: text.replace(/\s+/g, ' ').trim().slice(0, input.maxChars), metrics};
  } catch (error) {
    await finishAiCall(call.id, call.startedAt, 'FAILED', metrics, 'MEMORY_SUMMARY_FAILED').catch(() => null);
    throw error;
  }
}

interface SummaryTaskOutcome {outcome: string; detail?: string}

/**
 * 统一后台入口的 memory-summary 处理器。
 * 返回 SKIPPED_* 表示这次不需要做（关闭、消息不够、不是普通聊天），任务正常结束；
 * 抛错只用于「值得再试一次」的情形，由 runner 按 tasks.maxAttempts 有限重试。
 */
export async function runMemorySummaryTask(conversationId: string): Promise<SummaryTaskOutcome> {
  const settings = await readMemorySettings();
  if (!settings.enabled) return {outcome: 'SKIPPED_DISABLED'};
  const conversation = await db.conversation.findUnique({
    where: {id: conversationId},
    select: {id: true, userId: true, characterId: true, storyRun: {select: {id: true}}},
  });
  if (!conversation) return {outcome: 'SKIPPED_MISSING'};
  // 故事会话的长期状态由 StoryCheckpoint 管理，这里不重复生成。
  if (conversation.storyRun) return {outcome: 'SKIPPED_STORY'};

  const memory = await readMemorySummary(conversationId);
  const pending = await readMessagesAfter(conversationId, memory?.coveredMessageId ?? null);
  if (pending === null) {
    await invalidateMemorySummary(conversationId, 'COVERED_MESSAGE_MISSING');
    return {outcome: 'SKIPPED_INVALIDATED'};
  }
  if (pending.length < settings.summaryTriggerMessages) return {outcome: 'SKIPPED_BELOW_TRIGGER'};

  const template = await readSettingValue<string>('prompt.memorySummary');
  const prompt = buildSummaryPrompt(template, memory?.summary ?? null, pending, settings.summaryMaxChars);
  const lastMessageId = pending[pending.length - 1]!.id;

  let summary: string;
  if (!isAiChatAvailable(process.env)) {
    summary = mockSummary(pending.length, settings.summaryMaxChars);
  } else {
    try {
      const generated = await summarizeWithModel({conversationId, userId: conversation.userId, characterId: conversation.characterId, prompt, maxChars: settings.summaryMaxChars});
      if (!generated.text) throw new Error('EMPTY_SUMMARY');
      summary = generated.text;
    } catch (error) {
      if (error instanceof AiQuotaError) {
        // 预算不足：本轮不做，任务按轮询间隔再来，不算失败。
        logWarning('memory_summary_deferred', {conversationId, code: 'QUOTA_DEFERRED'});
        return {outcome: 'DEFERRED_QUOTA'};
      }
      throw error;
    }
  }

  await db.conversationMemory.upsert({
    where: {conversationId},
    create: {conversationId, summary, coveredMessageId: lastMessageId, version: 1},
    update: {summary, coveredMessageId: lastMessageId, version: {increment: 1}},
  });

  // 摘要顺带提出候选事实：一律 PENDING，等用户在聊天页确认，确认前不注入。
  let proposed = 0;
  for (const candidate of extractCandidateFacts(pending)) {
    const created = await proposeMemoryFact(conversationId, conversation.userId, candidate.text, candidate.sourceMessageId);
    if (created) proposed += 1;
  }
  return {outcome: 'SUMMARIZED', detail: `${TASK_LEASE_HINT}:${pending.length}:待确认${proposed}`};
}
