/**
 * State-extraction worker（V3 第 17 章，M4）。
 *
 * Every committed story turn leaves a durable PENDING task; this worker claims
 * tasks with a persisted lease (StoryTurn.leaseOwner/leaseExpiresAt), extracts
 * confirmed events from the already-saved messages, and commits events + the
 * state checkpoint + the run cursor in one transaction. Crash recovery never
 * re-sends the model generation — the messages are already committed; a retry
 * only redoes the extraction.
 *
 * Task ownership lives in the database, not in memory: a process restart loses
 * nothing because the scan re-claims expired leases. A live lease from another
 * worker is never stolen. If the turn left PROCESSING while we held the lease
 * (e.g. history invalidation raced in), the guarded commit writes nothing.
 */
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {logWarning} from '@/lib/logger';
import {readAiInteger} from '@/lib/ai/config';
import {StoryError} from '../repository/contracts';
import {runInclude} from '../repository/run-service';
import {isAiChatAvailable} from '@/lib/launch-guards';
import {readActiveAiProviders} from '@/lib/ai/providers/management-service';
import {readAiModelPlan, type RuntimeAiModel} from '@/lib/ai/models/runtime-service';
import {AiStreamError, aiErrorCode, modelChain, openUpstream, type RuntimeProvider} from '@/lib/conversations/chat-stream';
import {reserveAiCall, finishAiCall, AiQuotaError} from '@/lib/ai/ai-usage';
import type {AiStreamMetrics} from '@/lib/ai/types';
import {readExtraction, readState, withFacts, type ExtractedEvent, type StoryState} from './state-model';

const LEASE_MS = readAiInteger('STORY_STATE_LEASE_MS', 60_000, 5_000, 600_000);
const MAX_ATTEMPTS = readAiInteger('STORY_STATE_MAX_ATTEMPTS', 3, 1, 10);
const BATCH_LIMIT = readAiInteger('STORY_STATE_BATCH_LIMIT', 10, 1, 100);
const MAX_TURN_TEXT = 4000;

export interface StateWorkResult {claimed: number; processed: number; failed: number; deferred: number; skipped: number;}

type Client = Prisma.TransactionClient;
type RunRow = Prisma.StoryRunGetPayload<{include: typeof runInclude}>;

function workerId(): string {
  return `state-worker-${process.pid}-${randomUUID()}`;
}

/** Short transaction: PENDING (or expired PROCESSING) → PROCESSING with a fresh lease. */
async function claimTurn(tx: Client, turnId: string, owner: string, now: Date): Promise<boolean> {
  const claimed = await tx.storyTurn.updateMany({
    where: {id: turnId, OR: [{stateStatus: 'PENDING'}, {stateStatus: 'PROCESSING', leaseExpiresAt: {lt: now}}]},
    data: {stateStatus: 'PROCESSING', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), stateAttempts: {increment: 1}},
  });
  return claimed.count === 1;
}

/**
 * The extraction prompt never leaves this module; provider error bodies and turn
 * content are never logged (privacy rule: logs carry identifiers and codes only).
 */
function extractionPrompt(chapterTitle: string, state: StoryState, userContent: string, assistantContent: string): string {
  const known = state.facts.length ? state.facts.map(fact => `- ${fact}`).join('\n') : '（暂无）';
  return [
    '你是剧情状态整理器，从一轮已发生的对话中提取值得长期记住的故事事实。',
    '只输出 JSON，不要解释或 Markdown，格式：',
    '{"schemaVersion":1,"events":[{"type":"FACT","summary":"一句话事实"}]}',
    'type 只能是 FACT（已发生的事实）、PROMISE（约定/承诺）、RELATIONSHIP（关系变化）。',
    'summary 为不超过 200 字的陈述句。没有值得记录的内容时输出 {"schemaVersion":1,"events":[]}。',
    '不要编造对话中没有发生的事情。',
    '',
    `当前章节：${chapterTitle}`,
    '已确认的前情：',
    known,
    '',
    '本轮对话：',
    `用户：${userContent.slice(0, MAX_TURN_TEXT) || '（无）'}`,
    `角色：${assistantContent.slice(0, MAX_TURN_TEXT) || '（无）'}`,
  ].join('\n');
}

/** Mock extraction is clearly labelled so simulated state can never pass as real. */
function mockExtraction(turnNo: number): string {
  return JSON.stringify({schemaVersion: 1, events: [{type: 'FACT', summary: `【模拟整理】第 ${turnNo} 回合完成状态抽取（模拟环境，非真实抽取）。`}]});
}

async function readStreamText(response: Response & {body: ReadableStream<Uint8Array>}): Promise<string> {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim().startsWith('data:')) continue;
        const data = line.trim().slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed.choices?.[0]?.delta?.content === 'string') text += parsed.choices[0].delta.content;
        } catch { /* skip malformed keep-alive lines */ }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

async function readModelPlan(run: RunRow): Promise<{providers: RuntimeProvider[]; models: RuntimeAiModel[] | null}> {
  const modelPlan = await readAiModelPlan(run.conversation.aiModel, run.conversation.characterId);
  if (modelPlan?.length === 0) throw new AiStreamError('NO_MODEL');
  const configured = modelPlan === null ? await readActiveAiProviders() : [];
  const providers = configured.length
    ? [...configured, ...(process.env.OPENAI_API_KEY?.trim() ? [{id: 'environment', name: '环境配置', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY}] : [])]
    : [{id: 'environment', name: '环境配置', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY || ''}];
  return {providers, models: modelPlan && modelPlan.length ? modelPlan : null};
}

/** Same candidate chain as chat streaming, without a client-facing SSE stream. */
async function extractWithModel(run: RunRow, prompt: string): Promise<{text: string; metrics: AiStreamMetrics}> {
  const {providers, models} = await readModelPlan(run);
  const candidates = models?.length
    ? models.map(model => ({model: model.modelCode, provider: model.provider, config: model}))
    : modelChain(run.conversation.aiModel).flatMap(model => providers.map(provider => ({model, provider, config: undefined})));
  const metrics: AiStreamMetrics = {attempts: 0};
  let lastError: unknown = new AiStreamError('UPSTREAM_ERROR');
  for (const candidate of candidates) {
    metrics.model = candidate.model;
    metrics.modelKey = candidate.config?.key;
    metrics.attempts = (metrics.attempts || 0) + 1;
    try {
      const response = await openUpstream(candidate.model, prompt, [], '', undefined, candidate.provider, candidate.config);
      const text = await readStreamText(response);
      if (!text.trim()) throw new AiStreamError('EMPTY_RESPONSE');
      return {text, metrics};
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

function chapterTitleOf(run: RunRow, state: StoryState): string {
  try {
    // The definition was validated when the run was created; on any surprise fall
    // back to the chapter key rather than blocking extraction.
    const definition = JSON.parse(run.templateVersion.definitionJson) as {chapters?: Array<{key?: unknown; title?: unknown}>};
    const chapter = definition.chapters?.find(item => item.key === state.chapterKey);
    return typeof chapter?.title === 'string' && chapter.title.trim() ? chapter.title : state.chapterKey;
  } catch {
    return state.chapterKey;
  }
}

async function loadRun(runId: string): Promise<RunRow> {
  const run = await db.storyRun.findUnique({where: {id: runId}, include: runInclude});
  if (!run) throw new StoryError('STORY_NOT_FOUND', '故事不存在或暂不可用。', 404);
  return run;
}

async function failTurn(owner: string, turnId: string, errorCode: string) {
  await db.$transaction(async tx => {
    const turn = await tx.storyTurn.findUnique({where: {id: turnId}, select: {stateAttempts: true}});
    const exhausted = (turn?.stateAttempts ?? 0) >= MAX_ATTEMPTS;
    await tx.storyTurn.updateMany({
      where: {id: turnId, stateStatus: 'PROCESSING', leaseOwner: owner},
      data: {stateStatus: exhausted ? 'FAILED' : 'PENDING', errorCode, leaseOwner: null, leaseExpiresAt: null},
    });
  });
}

/** Quota/budget deferral: back to PENDING with a marker, never counted as an attempt. */
async function deferTurn(owner: string, turnId: string, errorCode: string) {
  await db.$transaction(async tx => {
    await tx.storyTurn.updateMany({
      where: {id: turnId, stateStatus: 'PROCESSING', leaseOwner: owner},
      data: {stateStatus: 'PENDING', errorCode, leaseOwner: null, leaseExpiresAt: null},
    });
  });
}

/**
 * Process one claimed turn. Returns 'skipped' when the claim failed or the turn
 * was settled elsewhere (e.g. invalidated by a history edit) — nothing is written.
 */
async function processTurn(turnId: string): Promise<'processed' | 'failed' | 'deferred' | 'skipped'> {
  const owner = workerId();
  const now = new Date();
  if (!await db.$transaction(tx => claimTurn(tx, turnId, owner, now))) return 'skipped';

  try {
    const turn = await db.storyTurn.findUnique({
      where: {id: turnId},
      select: {runId: true, turnNo: true, status: true, inputMessageId: true, assistantMessageId: true},
    });
    if (!turn || turn.status !== 'COMMITTED') {
      // Not a committable task (e.g. invalidated between scan and claim): release it.
      await db.storyTurn.updateMany({where: {id: turnId, stateStatus: 'PROCESSING', leaseOwner: owner}, data: {stateStatus: 'PENDING', leaseOwner: null, leaseExpiresAt: null}});
      return 'skipped';
    }
    const run = await loadRun(turn.runId);
    const state = readState(run.stateJson);
    if (!state) throw new StoryError('STATE_DATA_CORRUPT', '故事状态数据不完整，已停止整理以保护原数据。', 422);
    const [input, assistant] = await Promise.all([
      turn.inputMessageId ? db.message.findUnique({where: {id: turn.inputMessageId}, select: {content: true}}) : null,
      turn.assistantMessageId ? db.message.findUnique({where: {id: turn.assistantMessageId}, select: {content: true}}) : null,
    ]);
    const prompt = extractionPrompt(chapterTitleOf(run, state), state, input?.content ?? '', assistant?.content ?? '');

    // Real model when one is configured; otherwise the clearly labelled mock keeps
    // local pipelines runnable. Mock calls cost nothing and skip quota accounting.
    const plan = await readModelPlan(run);
    const realAi = Boolean(process.env.OPENAI_API_KEY?.trim()) || Boolean(plan.models?.length) || plan.providers.some(provider => provider.apiKey.trim());
    let events: ExtractedEvent[] | null;
    if (!realAi || !isAiChatAvailable(process.env)) {
      events = readExtraction(mockExtraction(turn.turnNo));
    } else {
      let reservedCall;
      try {
        reservedCall = await reserveAiCall(run.userId, run.conversationId, 'STATE_EXTRACT', plan.models?.map(model => model.key));
      } catch (error) {
        if (error instanceof AiQuotaError) {
          // 预算不足延后状态整理：the committed replies stay untouched and the task
          // stays PENDING for a later scan; deferral never counts toward MAX_ATTEMPTS.
          await deferTurn(owner, turnId, 'QUOTA_DEFERRED');
          logWarning('story_state_extraction_deferred', {turnId, code: 'QUOTA_DEFERRED'});
          return 'deferred';
        }
        throw error;
      }
      try {
        const extracted = await extractWithModel(run, prompt);
        events = readExtraction(extracted.text);
        await finishAiCall(reservedCall.id, reservedCall.startedAt, events ? 'SUCCEEDED' : 'FAILED', extracted.metrics, events ? undefined : 'STATE_FORMAT_ERROR').catch(() => {});
      } catch (error) {
        await finishAiCall(reservedCall.id, reservedCall.startedAt, 'FAILED', {attempts: 0}, aiErrorCode(error)).catch(() => {});
        throw error;
      }
    }
    if (!events) throw new StoryError('STATE_FORMAT_ERROR', '状态整理结果无法解析。', 422);

    const committed = await db.$transaction(async tx => {
      // Lease-guarded settle: if the turn left PROCESSING under our lease, the
      // derived history was invalidated meanwhile and must not be resurrected.
      const settled = await tx.storyTurn.updateMany({
        where: {id: turnId, stateStatus: 'PROCESSING', leaseOwner: owner},
        data: {stateStatus: 'PROCESSED', leaseOwner: null, leaseExpiresAt: null, errorCode: null},
      });
      if (!settled.count) return false;
      const added: string[] = [];
      for (const event of events) {
        await tx.storyEvent.create({data: {
          runId: run.id, sourceTurnId: turnId, chapterKey: run.chapterKey,
          type: event.type, status: 'CONFIRMED', payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: event.summary}),
          sourceMessageId: turn.inputMessageId,
        }});
        added.push(event.summary);
      }
      const nextState = withFacts(state, added);
      const revision = run.revision + 1;
      await tx.storyCheckpoint.create({data: {runId: run.id, throughTurnNo: turn.turnNo, revision, stateJson: JSON.stringify(nextState)}});
      await tx.storyRun.updateMany({
        where: {id: run.id, stateProcessedThroughTurnNo: {lt: turn.turnNo}},
        data: {stateJson: JSON.stringify(nextState), stateProcessedThroughTurnNo: turn.turnNo, revision: {increment: 1}},
      });
      return true;
    });
    return committed ? 'processed' : 'skipped';
  } catch (error) {
    const code = error instanceof StoryError ? error.code : aiErrorCode(error);
    await failTurn(owner, turnId, code);
    logWarning('story_state_extraction_failed', {turnId, code});
    return 'failed';
  }
}

/** Scan due tasks and process them sequentially (SQLite favours one writer). */
export async function processPendingStateWork(limit = BATCH_LIMIT): Promise<StateWorkResult> {
  const due = await db.storyTurn.findMany({
    where: {OR: [{stateStatus: 'PENDING'}, {stateStatus: 'PROCESSING', leaseExpiresAt: {lt: new Date()}}]},
    orderBy: [{turnNo: 'asc'}, {id: 'asc'}], take: limit, select: {id: true},
  });
  const result: StateWorkResult = {claimed: due.length, processed: 0, failed: 0, deferred: 0, skipped: 0};
  for (const turn of due) {
    const outcome = await processTurn(turn.id);
    if (outcome === 'processed') result.processed += 1;
    else if (outcome === 'failed') result.failed += 1;
    else if (outcome === 'deferred') result.deferred += 1;
    else result.skipped += 1;
  }
  return result;
}

let stop: (() => void) | null = null;

/**
 * Starts the in-process scan loop. Tasks persist in the database, so stopping
 * and restarting the process (worker 暂停/恢复) loses nothing; the first tick
 * re-claims whatever expired while the process was down.
 */
export function startStateWorker(): () => void {
  if (stop) return stop;
  const intervalMs = readAiInteger('STORY_STATE_INTERVAL_MS', 15_000, 1_000, 600_000);
  const timer = setInterval(() => {
    processPendingStateWork().catch(error => logWarning('story_state_worker_tick_failed', {code: aiErrorCode(error)}));
  }, intervalMs);
  timer.unref?.();
  stop = () => { clearInterval(timer); stop = null; };
  // 默认态就是「开着」，所以启动必须留一条可 grep 的记录：否则进程里 worker 有没有跑
  // 完全不可观测，状态提取停摆时只能等用户发现剧情不再推进。
  console.info(JSON.stringify({event: 'story_state_worker_started', intervalMs}));
  return stop;
}
