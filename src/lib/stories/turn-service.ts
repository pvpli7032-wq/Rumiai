/**
 * M3-3 story turn orchestration: one accepted request is one story turn.
 *
 * Reliability model (docs/planning/m3-data-contract.md §6):
 * - Accept is a short transaction: revision CAS + the unique activeTurnId slot.
 * - The USER/ASSISTANT messages, the turn row and the run cursor commit in ONE
 *   transaction after generation; a turn that never committed never saved a message.
 * - Terminal turns are idempotency records: the same (runId, requestId) with the
 *   same requestHash replays the outcome, a different hash is a conflict, and an
 *   UNKNOWN/FAILED/CANCELLED turn is surfaced instead of silently regenerated.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { StoryError, parseTurn } from './repository/contracts';
import { readStoryRun, requireVisibleRun, requirePublishedTemplate, runInclude } from './repository/run-service';
import { logRouteError } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { readActiveAiProviders } from '@/lib/ai/providers/management-service';
import { readAiModelPlan } from '@/lib/ai/models/runtime-service';
import { aiErrorCode, aiUserError, streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';
import { readRecentMessageHistory } from '@/lib/conversations/message-service';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import type { AiStreamMetrics } from '@/lib/ai/types';

type Run = Prisma.StoryRunGetPayload<{include: typeof runInclude}>;
type TurnRow = Prisma.StoryTurnGetPayload<Record<string, never>>;

export interface StoryTurnRequest { userId: string; runId: string; input: unknown; signal: AbortSignal; }

function requestHash(content: string): string {
  return createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex');
}

type ExistingKind = 'committed' | 'in-progress' | 'terminal';

function classifyExisting(turn: Pick<TurnRow, 'status' | 'requestHash'> | null, hash: string): ExistingKind | 'conflict' | null {
  if (!turn) return null;
  if (turn.requestHash !== hash) return 'conflict';
  if (turn.status === 'ACCEPTED' || turn.status === 'GENERATING') return 'in-progress';
  if (turn.status === 'COMMITTED') return 'committed';
  return 'terminal';
}

const TERMINAL_ERROR: Record<string, {code: string; message: string}> = {
  FAILED: {code: 'TURN_FAILED', message: '回合未能完成，请使用新的请求重试。'},
  UNKNOWN: {code: 'TURN_UNKNOWN', message: '回合结果未知，请先查询回合状态确认后再重试。'},
  CANCELLED: {code: 'TURN_CANCELLED', message: '回合已取消，请使用新的请求重试。'},
};

function replayTurn(run: {revision: number}, turn: TurnRow): {kind: 'replay'; turn: TurnRow; revision: number} {
  return {kind: 'replay', turn, revision: run.revision};
}

/**
 * Idempotent accept. Returns a replay for an already-settled turn, or a fresh
 * accept that holds the activeTurn slot at `revision = expectedRevision + 1`.
 */
async function acceptTurn(userId: string, runId: string, expectedRevision: number, requestId: string, hash: string) {
  try {
    return await db.$transaction(async tx => {
      const run = await requireVisibleRun(tx, userId, runId);
      if (run.status !== 'ACTIVE') throw new StoryError('RUN_NOT_ACTIVE', '故事当前不在进行中，无法继续回合。', 409);
      requirePublishedTemplate(run);
      const existing = await tx.storyTurn.findUnique({where: {runId_requestId: {runId, requestId}}});
      const classified = classifyExisting(existing, hash);
      if (classified === 'conflict') throw new StoryError('REQUEST_CONFLICT', '请求标识已用于不同的回合内容。', 409);
      if (classified === 'in-progress') throw new StoryError('TURN_IN_PROGRESS', '同一回合仍在生成中，请稍后查询结果。', 409);
      if (classified === 'committed' || classified === 'terminal') return replayTurn(run, existing!);
      const turnNo = ((await tx.storyTurn.aggregate({where: {runId}, _max: {turnNo: true}}))._max.turnNo ?? 0) + 1;
      const turn = await tx.storyTurn.create({data: {runId, turnNo, requestId, requestHash: hash, operation: 'SEND', startedAt: new Date()}});
      const claimed = await tx.storyRun.updateMany({
        where: {id: runId, userId, revision: expectedRevision, activeTurnId: null},
        data: {revision: {increment: 1}, activeTurnId: turn.id},
      });
      if (claimed.count === 0) {
        const current = await tx.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true, activeTurnId: true}});
        if (current.activeTurnId) throw new StoryError('TURN_IN_PROGRESS', '上一个回合仍在进行中，请等待完成后再发送。', 409);
        throw new StoryError('REVISION_CONFLICT', '故事状态已更新，请刷新后重试。', 409, {currentRevision: current.revision});
      }
      return {kind: 'accepted' as const, turn, run, revision: expectedRevision + 1};
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A concurrent sibling request created the same idempotency record (or turn number) first.
      const existing = await db.storyTurn.findUnique({where: {runId_requestId: {runId, requestId}}});
      const classified = classifyExisting(existing, hash);
      if ((classified === 'committed' || classified === 'terminal') && existing) {
        const run = await db.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true}});
        return replayTurn(run, existing);
      }
      if (classified === 'in-progress') throw new StoryError('TURN_IN_PROGRESS', '同一回合仍在生成中，请稍后查询结果。', 409);
      if (classified === 'conflict') throw new StoryError('REQUEST_CONFLICT', '请求标识已用于不同的回合内容。', 409);
      const current = await db.storyRun.findUnique({where: {id: runId}, select: {activeTurnId: true}});
      if (current?.activeTurnId) throw new StoryError('TURN_IN_PROGRESS', '上一个回合仍在进行中，请等待完成后再发送。', 409);
    }
    if (error instanceof StoryError && error.code === 'REVISION_CONFLICT' && error.data && !('run' in error.data)) {
      // Contract: a revision conflict returns the current public run view.
      const {run} = await readStoryRun(userId, runId);
      throw new StoryError(error.code, error.message, 409, {...error.data, run});
    }
    throw error;
  }
}

/** Clear the activeTurn slot and settle a non-committed turn; safe to call twice. */
async function abandonTurn(runId: string, turnId: string, status: 'FAILED' | 'CANCELLED', errorCode: string) {
  try {
    await db.$transaction(async tx => {
      await tx.storyTurn.updateMany({where: {id: turnId, status: {in: ['ACCEPTED', 'GENERATING']}}, data: {status, errorCode}});
      await tx.storyRun.updateMany({where: {id: runId, activeTurnId: turnId}, data: {activeTurnId: null}});
    });
  } catch (error) { logRouteError('POST /api/story-runs/[id]/turns (abandon)', error); }
}

/** One atomic commit: both messages, the turn row and the run cursor, or nothing. */
async function commitTurn(run: Run, turn: {id: string; turnNo: number}, userContent: string, assistantContent: string | null, acceptedRevision: number) {
  return db.$transaction(async tx => {
    // The user's own words and the assistant reply are distinct rows; an earlier
    // revision persisted the assistant text into both, losing the user input.
    const userMessage = await tx.message.create({data: {conversationId: run.conversationId, role: 'USER', content: userContent}});
    const assistant = assistantContent?.trim()
      ? await tx.message.create({data: {conversationId: run.conversationId, role: 'ASSISTANT', content: assistantContent}})
      : null;
    const claimed = await tx.storyTurn.updateMany({
      where: {id: turn.id, status: {in: ['ACCEPTED', 'GENERATING']}},
      data: {status: 'COMMITTED', inputMessageId: userMessage.id, ...(assistant ? {assistantMessageId: assistant.id} : {}), committedAt: new Date(), stateStatus: 'PENDING', errorCode: null},
    });
    if (!claimed.count) throw new StoryError('TURN_STATE_CONFLICT', '回合状态已变化，无法提交。', 409);
    const runClaimed = await tx.storyRun.updateMany({
      where: {id: run.id, revision: acceptedRevision, activeTurnId: turn.id},
      data: {revision: {increment: 1}, lastCommittedTurnNo: turn.turnNo, activeTurnId: null},
    });
    if (!runClaimed.count) throw new StoryError('REVISION_CONFLICT', '故事状态已更新，提交失败。', 409);
    await tx.conversation.update({where: {id: run.conversationId}, data: {updatedAt: new Date()}});
    await tx.character.update({where: {id: run.conversation.characterId}, data: {messageCount: {increment: assistant ? 2 : 1}}});
    return {userMessageId: userMessage.id, assistantMessageId: assistant?.id ?? null, revision: acceptedRevision + 1};
  });
}

function replayStream(replay: {turn: TurnRow; revision: number}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const push = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const turn = replay.turn;
      if (turn.status === 'COMMITTED') {
        push({type: 'committed', turnId: turn.id, userMessageId: turn.inputMessageId, assistantMessageId: turn.assistantMessageId, revision: replay.revision});
        push({type: 'state_pending', turnId: turn.id, stateStatus: turn.stateStatus});
      } else {
        const failure = TERMINAL_ERROR[turn.status] ?? {code: 'TURN_FAILED', message: '回合未能完成，请使用新的请求重试。'};
        push({type: 'error', turnId: turn.id, code: turn.errorCode ?? failure.code, message: failure.message});
      }
      push({type: 'done', turnId: turn.id});
      controller.close();
    },
  });
}

export async function executeStoryTurn(input: StoryTurnRequest): Promise<ReadableStream<Uint8Array>> {
  const {expectedRevision, requestId, content} = parseTurn(input.input);
  const hash = requestHash(content);

  // Fast idempotency path before any quota or rate-limit cost: a settled turn replays as-is.
  const prior = classifyExisting(await db.storyTurn.findUnique({where: {runId_requestId: {runId: input.runId, requestId}}}), hash);
  if (prior === 'conflict') throw new StoryError('REQUEST_CONFLICT', '请求标识已用于不同的回合内容。', 409);
  if (prior === 'in-progress') throw new StoryError('TURN_IN_PROGRESS', '同一回合仍在生成中，请稍后查询结果。', 409);
  if (prior === 'committed' || prior === 'terminal') {
    const run = await requireVisibleRun(db, input.userId, input.runId);
    const turn = await db.storyTurn.findUniqueOrThrow({where: {runId_requestId: {runId: input.runId, requestId}}});
    return replayStream(replayTurn(run, turn));
  }

  const run = await requireVisibleRun(db, input.userId, input.runId);
  if (run.status !== 'ACTIVE') throw new StoryError('RUN_NOT_ACTIVE', '故事当前不在进行中，无法继续回合。', 409);
  requirePublishedTemplate(run);

  let usingRealAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const modelPlan = await readAiModelPlan(run.conversation.aiModel, run.conversation.characterId);
  if (modelPlan?.length === 0) throw new StoryError('NO_MODEL', '当前角色暂无可用模型，请重新选择模型或联系管理员。', 503);
  const configuredProviders = modelPlan === null ? await readActiveAiProviders() : [];
  usingRealAi = usingRealAi || configuredProviders.length > 0 || Boolean(modelPlan?.length);
  if (!isAiChatAvailable({...process.env, OPENAI_API_KEY: usingRealAi ? 'configured' : ''})) {
    throw new StoryError('AI_UNAVAILABLE', 'AI 服务未配置，暂时无法聊天。', 503);
  }
  const burst = checkRateLimit('chat:min:' + input.userId, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!burst.allowed) throw new StoryError('RATE_LIMITED', '发送过快，请稍后再试。', 429, {retryAfter: burst.retryAfter});
  const reservedCall = await reserveAiCall(input.userId, run.conversationId, 'SEND', modelPlan?.map(model => model.key));
  let settled = false;
  const settle = async (status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'MOCK', metrics: AiStreamMetrics, errorCode?: string) => {
    if (settled) return;
    settled = true;
    await finishAiCall(reservedCall.id, reservedCall.startedAt, status, metrics, errorCode).catch(() => {});
  };

  const accepted = await acceptTurn(input.userId, input.runId, expectedRevision, requestId, hash);
  if (accepted.kind === 'replay') {
    // A concurrent sibling won the accept while quota was reserved; no model call happened.
    await settle('FAILED', {}, 'TURN_REJECTED');
    return replayStream(accepted);
  }
  const turn = accepted.turn;

  const abort = new AbortController();
  let cancelled = false;
  const onAbort = () => { cancelled = true; abort.abort(new DOMException('Client disconnected', 'AbortError')); };
  input.signal.addEventListener('abort', onAbort, {once: true});
  if (input.signal.aborted) onAbort();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: Record<string, unknown>) => {
        if (cancelled) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* disconnected */ }
      };
      const mapEvent = (event: Record<string, unknown>) => ('content' in event ? {type: 'delta', turnId: turn.id, content: event.content} : {type: 'demo', turnId: turn.id});
      emit({type: 'accepted', turnId: turn.id, revision: accepted.revision});

      let metrics: AiStreamMetrics = {};
      let assistantContent: string | null = null;
      let failure: {code: string; message: string} | null = null;
      try {
        await db.storyTurn.updateMany({where: {id: turn.id, status: 'ACCEPTED'}, data: {status: 'GENERATING'}});
        // The user message is not persisted yet, so nothing is excluded from history.
        const history = await readRecentMessageHistory(run.conversationId, '', HISTORY_TURNS);
        assistantContent = usingRealAi
          ? await streamOpenAIResponse(controller, run.conversation.character, history, content, run.conversation.aiModel, {signal: abort.signal, onMetrics: value => { metrics = value; }, providers: configuredProviders, models: modelPlan ?? undefined, mapEvent})
          : await streamMockResponse(controller, run.conversation.character, content, abort.signal, {mapEvent});
      } catch (error) {
        logRouteError('POST /api/story-runs/[id]/turns', error);
        const code = cancelled ? 'CANCELLED' : aiErrorCode(error);
        await abandonTurn(run.id, turn.id, cancelled ? 'CANCELLED' : 'FAILED', code);
        await settle(cancelled ? 'CANCELLED' : 'FAILED', metrics, code);
        failure = {code, message: cancelled ? '回合已取消。' : aiUserError(error)};
      }
      if (!failure) {
        try {
          const receipt = await commitTurn(run, turn, content, assistantContent, accepted.revision);
          emit({type: 'committed', turnId: turn.id, ...receipt});
          emit({type: 'state_pending', turnId: turn.id, stateStatus: 'PENDING'});
          await settle(usingRealAi ? 'SUCCEEDED' : 'MOCK', metrics);
        } catch (error) {
          logRouteError('POST /api/story-runs/[id]/turns (persistence)', error);
          await abandonTurn(run.id, turn.id, 'FAILED', 'PERSISTENCE_ERROR');
          await settle('FAILED', metrics, 'PERSISTENCE_ERROR');
          failure = {code: 'PERSISTENCE_ERROR', message: '回合保存失败，请刷新后确认。'};
        }
      }
      if (failure) emit({type: 'error', turnId: turn.id, code: failure.code, message: failure.message});
      emit({type: 'done', turnId: turn.id});
      input.signal.removeEventListener('abort', onAbort);
      if (!cancelled) controller.close();
    },
    cancel() { onAbort(); },
  });
}

export {AiQuotaError};
