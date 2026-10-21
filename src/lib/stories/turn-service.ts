/**
 * M3-3 story turn orchestration: one accepted request is one story turn.
 *
 * Reliability model（V3 第 17 章）：
 * - Accept is a short transaction: revision CAS + the unique activeTurnId slot.
 * - The USER/ASSISTANT messages, the turn row and the run cursor commit in ONE
 *   transaction after generation; a turn that never committed never saved a message.
 * - Terminal turns are idempotency records: the same (runId, requestId) with the
 *   same requestHash replays the outcome, a different hash is a conflict, and an
 *   UNKNOWN/FAILED/CANCELLED turn is surfaced instead of silently regenerated.
 *
 * 计费（V3 第 20/21 章）：STORY_TURN 走与普通聊天同一个 @/lib/billing 费用服务。
 * 预扣在预留 AiCall 之前；回合提交成功后结算（记下回复消息 id），失败/取消释放；
 * 关闭收费时不建费用单，只记 AiCall 成本。相同 requestId 重放不重复扣费。
 */
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
import { buildStoryContext } from './lifecycle/context-service';
import {readChatRules} from '@/lib/settings';
import type { AiStreamMetrics } from '@/lib/ai/types';
import {beginBillingTurn, readBalance, readTurnReceipt, toChargeError, type BillingTurn} from '@/lib/billing/turn';
import {classifyExisting, replayStream, replayTurn, requestHash, type TurnRow} from './turn-replay';

type Run = Prisma.StoryRunGetPayload<{include: typeof runInclude}>;

export interface StoryTurnRequest { userId: string; runId: string; input: unknown; signal: AbortSignal; }

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

/**
 * One atomic commit: both messages, the turn row and the run cursor, or nothing.
 *
 * 提交成功之后才结算（caller 里紧跟着 billing.settle）；万一结算那一步中断，
 * recovery 读回合的权威状态（COMMITTED）补结算，不会出现「回合已提交、费用仍冻结」。
 */
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

/** 计费回执随 SSE 发出，避免为了计数再查一次库。 */
async function costEvents(party: Parameters<typeof readTurnReceipt>[0]): Promise<Record<string, unknown>[]> {
  const receipt = await readTurnReceipt(party);
  if (!receipt) return [];
  return [{costResult: {...receipt, balance: await readBalance(party.userId)}}];
}

export async function executeStoryTurn(input: StoryTurnRequest): Promise<ReadableStream<Uint8Array>> {
  const {expectedRevision, requestId, content} = parseTurn(input.input);
  const hash = requestHash(content);

  // Ownership first: the idempotency lookup below must never answer for a run the
  // caller cannot see, not even with a 409 that would leak "a turn is in progress".
  const run = await requireVisibleRun(db, input.userId, input.runId);

  // Fast idempotency path before any quota or rate-limit cost: a settled turn replays as-is.
  const prior = classifyExisting(await db.storyTurn.findUnique({where: {runId_requestId: {runId: input.runId, requestId}}}), hash);
  if (prior === 'conflict') throw new StoryError('REQUEST_CONFLICT', '请求标识已用于不同的回合内容。', 409);
  if (prior === 'in-progress') throw new StoryError('TURN_IN_PROGRESS', '同一回合仍在生成中，请稍后查询结果。', 409);
  if (prior === 'committed' || prior === 'terminal') {
    const turn = await db.storyTurn.findUniqueOrThrow({where: {runId_requestId: {runId: input.runId, requestId}}});
    // 相同请求号重放：返回同一回合与同一费用单，不再扣币。
    return replayStream(replayTurn(run, turn), await costEvents({userId: input.userId, conversationId: run.conversationId, operation: 'STORY_TURN', requestId}));
  }

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
  const rules = await readChatRules();
  const burst = checkRateLimit('chat:min:' + input.userId, rules.perWindow, rules.windowMs);
  if (!burst.allowed) throw new StoryError('RATE_LIMITED', '发送过快，请稍后再试。', 429, {retryAfter: burst.retryAfter});

  // 与普通聊天同一费用服务：先预扣再预留 AiCall；余额不足 402，不占用当日额度。
  let billing: BillingTurn;
  try {
    billing = await beginBillingTurn({userId: input.userId, conversationId: run.conversationId, operation: 'STORY_TURN', requestId}, {modelKey: modelPlan?.[0]?.key ?? null});
  } catch (error) {
    const chargeError = toChargeError(error);
    if (chargeError) throw new StoryError(chargeError.body.code === 'INSUFFICIENT_COINS' ? 'INSUFFICIENT_COINS' : 'REQUEST_CONFLICT', chargeError.message, chargeError.status, chargeError.body);
    throw error;
  }
  // 相同 requestId 重放：费用单已在，说明这次回合要么在生成、要么已结算，绝不重复扣费。
  if (billing.hold.replayed) {
    if (billing.hold.status === 'SETTLED' && billing.hold.messageId) {
      const turn = await db.storyTurn.findUnique({where: {runId_requestId: {runId: input.runId, requestId}}});
      if (turn) return replayStream(replayTurn(run, turn), await costEvents({userId: input.userId, conversationId: run.conversationId, operation: 'STORY_TURN', requestId}));
    }
    if (billing.hold.status === 'HELD') throw new StoryError('TURN_IN_PROGRESS', '同一回合仍在生成中，请稍后查询结果。', 409);
    throw new StoryError('REQUEST_CONFLICT', '这条请求已结束且没有产生回复，请重新发送。', 409);
  }
  const reservedCall = await reserveAiCall(input.userId, run.conversationId, 'SEND', modelPlan?.map(model => model.key), 'story');
  let settled = false;
  const settle = async (status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'MOCK', metrics: AiStreamMetrics, errorCode?: string) => {
    if (settled) return;
    settled = true;
    await finishAiCall(reservedCall.id, reservedCall.startedAt, status, metrics, errorCode).catch(() => {});
  };

  const accepted = await acceptTurn(input.userId, input.runId, expectedRevision, requestId, hash);
  if (accepted.kind === 'replay') {
    // 并发同号的兄弟请求先拿到了回合位：本次没有调用模型，也不能释放那张共用的费用单
    // （否则兄弟的这次生成就白送了）。只回收自己的 AiCall 预留，费用单交给它的实际结果。
    await settle('FAILED', {}, 'TURN_REJECTED');
    if (accepted.turn.status === 'COMMITTED') await billing.settle({messageId: accepted.turn.assistantMessageId}).catch(error => logRouteError('POST /api/story-runs/[id]/turns (charge settle)', error));
    return replayStream(accepted, await costEvents({userId: input.userId, conversationId: run.conversationId, operation: 'STORY_TURN', requestId}));
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
      // 「已输出」在首个内容片段写入响应流的那一刻成立，而不是整段生成结束之后。
      const mapEvent = (event: Record<string, unknown>) => {
        if ('content' in event) billing.sawOutput();
        return 'content' in event ? {type: 'delta', turnId: turn.id, content: event.content} : {type: 'demo', turnId: turn.id};
      };
      const notice = billing.notice();
      if (notice) emit({type: 'cost', turnId: turn.id, ...notice});
      emit({type: 'accepted', turnId: turn.id, revision: accepted.revision});

      let metrics: AiStreamMetrics = {};
      let assistantContent: string | null = null;
      let failure: {code: string; message: string} | null = null;
      try {
        await db.storyTurn.updateMany({where: {id: turn.id, status: 'ACCEPTED'}, data: {status: 'GENERATING'}});
        // The user message is not persisted yet, so nothing is excluded from history.
        const history = await readRecentMessageHistory(run.conversationId, '', rules.historyMessages);
        const storyContext = buildStoryContext(run);
        const streamOptions = {signal: abort.signal, onMetrics: (value: AiStreamMetrics) => { metrics = value; }, providers: configuredProviders, models: modelPlan ?? undefined, mapEvent, context: storyContext};
        assistantContent = usingRealAi
          ? await streamOpenAIResponse(controller, run.conversation.character, history, content, run.conversation.aiModel, streamOptions)
          : await streamMockResponse(controller, run.conversation.character, content, abort.signal, {mapEvent, context: storyContext});
      } catch (error) {
        // 用户取消是我们自己 abort 造成的中断：不能当成供应商故障，交给下面的取消策略判定。
        if (!cancelled || aiErrorCode(error) !== 'CANCELLED') {
          logRouteError('POST /api/story-runs/[id]/turns', error);
          const code = aiErrorCode(error);
          await abandonTurn(run.id, turn.id, 'FAILED', code);
          await settle('FAILED', metrics, code);
          await billing.release(code).catch(releaseError => logRouteError('POST /api/story-runs/[id]/turns (charge release)', releaseError));
          failure = {code, message: aiUserError(error)};
        }
      }
      const delivered = billing.deliveredOutput();
      if (!failure && cancelled && !delivered) {
        // 用户取消且未输出：不提交回合、不收费，也不消耗免费取消次数。
        await abandonTurn(run.id, turn.id, 'CANCELLED', 'CANCELLED');
        await settle('CANCELLED', metrics, 'CANCELLED');
        await billing.release('CANCELLED');
        failure = {code: 'CANCELLED', message: '回合已取消。'};
      } else if (!failure) {
        try {
          const receipt = await commitTurn(run, turn, content, assistantContent, accepted.revision);
          // 回合与消息先提交；用户取消按取消策略落账，正常结束按已输出结算。
          // 结算若中断，recovery 按回合权威状态补结算，不会出现「回合已提交、费用仍冻结」。
          if (cancelled) await billing.cancel({messageId: receipt.assistantMessageId, aiCallId: reservedCall.id}).catch(error => logRouteError('POST /api/story-runs/[id]/turns (charge cancel)', error));
          else await billing.settle({messageId: receipt.assistantMessageId, aiCallId: reservedCall.id}).catch(error => logRouteError('POST /api/story-runs/[id]/turns (charge settle)', error));
          emit({type: 'committed', turnId: turn.id, ...receipt});
          emit({type: 'state_pending', turnId: turn.id, stateStatus: 'PENDING'});
          await settle(cancelled ? 'CANCELLED' : usingRealAi ? 'SUCCEEDED' : 'MOCK', metrics, cancelled ? 'CANCELLED' : undefined);
        } catch (error) {
          logRouteError('POST /api/story-runs/[id]/turns (persistence)', error);
          await abandonTurn(run.id, turn.id, 'FAILED', 'PERSISTENCE_ERROR');
          await settle('FAILED', metrics, 'PERSISTENCE_ERROR');
          await billing.release('PERSISTENCE_ERROR').catch(releaseError => logRouteError('POST /api/story-runs/[id]/turns (charge release)', releaseError));
          failure = {code: 'PERSISTENCE_ERROR', message: '回合保存失败，请刷新后确认。'};
        }
      }
      for (const event of await costEvents({userId: input.userId, conversationId: run.conversationId, operation: 'STORY_TURN', requestId}).catch(() => [])) emit(event);
      if (failure) emit({type: 'error', turnId: turn.id, code: failure.code, message: failure.message});
      emit({type: 'done', turnId: turn.id});
      input.signal.removeEventListener('abort', onAbort);
      if (!cancelled) controller.close();
    },
    cancel() { onAbort(); },
  });
}

export {AiQuotaError};