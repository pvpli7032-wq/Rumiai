import { logRouteError } from '@/lib/logger';
import { ConversationError, readConversationForChat } from '@/lib/conversations/conversation-service';
import { ConversationMessageError, createUserMessage, prepareMessageRegeneration, readRecentMessageHistory, persistAssistantResponse, replaceMessageReply } from '@/lib/conversations/message-service';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError, streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import {readChatRules} from '@/lib/settings';
import {buildMemoryContext, enqueueSummaryIfDue} from '@/lib/memory';
import {readActiveAiProviders} from '@/lib/ai/providers/management-service';
import {readAiModelPlan} from '@/lib/ai/models/runtime-service';
import {beginBillingTurn, parseJsonBody, readBalance, readTurnReceipt, resolveRequestId, toChargeError, type BillingTurn} from '@/lib/billing/turn';
import {db} from '@/lib/db';

export type ChatTurnMode = 'SEND' | 'REGENERATE';
export type ChatTurnInput = {request: Request} | {targetMessageId: string; requestId?: string};

/** 与费用单的 operation 一一对应：SEND → CHAT_SEND，REGENERATE → CHAT_REGENERATE。 */
const CHARGE_OPERATION: Record<ChatTurnMode, 'CHAT_SEND' | 'CHAT_REGENERATE'> = {SEND: 'CHAT_SEND', REGENERATE: 'CHAT_REGENERATE'};
export interface ChatTurnRequest { userId: string; conversationId: string; mode: ChatTurnMode; input: ChatTurnInput; signal: AbortSignal; }
export interface ChatTurnResult { mode: ChatTurnMode; stream: ReadableStream<Uint8Array>; }
export class ChatTurnHttpError extends Error { constructor(message: string, readonly status: number, readonly headers?: HeadersInit) { super(message); this.name = 'ChatTurnHttpError'; } }
function emit(controller: ReadableStreamDefaultController<Uint8Array>, data: string, cancelled: () => boolean) { if (cancelled()) return; try { controller.enqueue(new TextEncoder().encode(data)); } catch { /* disconnected */ } }

/** 重放已保存的回复：同一 requestId 返回同一结果与同一费用单（V3 表 17「重复请求」）。 */
async function replayStream(content: string, billing: BillingTurn, input: ChatTurnRequest): Promise<ReadableStream<Uint8Array>> {
  const receipt = await readTurnReceipt({userId: input.userId, conversationId: input.conversationId, operation: input.mode === 'SEND' ? 'CHAT_SEND' : 'CHAT_REGENERATE', requestId: billing.requestId});
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: Record<string, unknown>) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
      push({content});
      if (receipt) push({costResult: {...receipt, balance: await readBalance(input.userId)}});
      push({replayed: true});
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/**
 * 计费（V3 第 20/21 章）：SEND / REGENERATE 各一次预扣 → 结算/释放，统一走 @/lib/billing。
 * - 预扣在预留 AiCall 与写消息之前；余额不足直接 402，不调用模型、不占当日调用额度。
 * - 「已输出即收费」：首个内容片段送达用户后取消也结算；未输出则释放（免费次数一并还回）。
 * - 消息保存成功 → 结算；保存失败或生成失败 → 释放。相同 requestId 重放返回同一费用单。
 */
export async function executeChatTurn(input: ChatTurnRequest): Promise<ChatTurnResult> {
  let reservedCall: {id: string; startedAt: Date} | undefined;
  let usingRealAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const conversation = await readConversationForChat(input.userId, input.conversationId);
  if (conversation.storyRun) throw new ChatTurnHttpError('故事回合服务尚未开放，暂时无法发送或重新生成。', 409);
  // 规则每次请求现读（带 15 秒缓存）：后台改完设置，下一个请求就按新值校验。
  const rules = await readChatRules();
  const body = input.mode === 'SEND' ? await parseJsonBody('request' in input.input ? input.input.request : undefined) : null;
  const requestId = resolveRequestId(input.mode === 'SEND' ? body?.requestId : ('requestId' in input.input ? input.input.requestId : null));
  let content: string; let history: Awaited<ReturnType<typeof readRecentMessageHistory>> | undefined; let replaceAt: Date | undefined;
  if (input.mode === 'SEND') {
    // 请求体缺失或不是合法 JSON 对象：直接按格式错误拒绝，不要落到「须为文本」。
    if (!('request' in input.input) || !body) throw new ChatTurnHttpError('消息数据格式不正确。', 400);
    const raw = (body as {content?: unknown}).content;
    if (typeof raw !== 'string' || raw.length > rules.maxMessageChars) throw new ChatTurnHttpError(`消息须为文本，最多 ${rules.maxMessageChars} 字。`, 400);
    if (!raw.trim()) throw new ChatTurnHttpError('Message content is required', 400);
    content = raw.trim();
  } else {
    if (!('targetMessageId' in input.input)) throw new ChatTurnHttpError('Internal server error', 500);
    const prepared = await prepareMessageRegeneration(input.userId, input.conversationId, input.input.targetMessageId, rules.historyMessages);
    content = prepared.prompt.content; history = prepared.history; replaceAt = prepared.prompt.createdAt;
  }
  const modelPlan = await readAiModelPlan(conversation.aiModel, conversation.characterId);
  if (modelPlan?.length === 0) throw new ChatTurnHttpError('当前角色暂无可用模型，请重新选择模型或联系管理员。', 503);
  const configuredProviders = modelPlan === null ? await readActiveAiProviders() : [];
  usingRealAi = usingRealAi || configuredProviders.length > 0 || Boolean(modelPlan?.length);
  if (!isAiChatAvailable({...process.env, OPENAI_API_KEY: usingRealAi ? 'configured' : ''})) throw new ChatTurnHttpError(input.mode === 'SEND' ? 'AI 服务未配置，暂时无法聊天。' : 'AI 服务未配置，暂时无法重新生成回复。', 503);
  const burst = checkRateLimit('chat:min:' + input.userId, rules.perWindow, rules.windowMs);
  if (!burst.allowed) throw new ChatTurnHttpError('发送过快，请稍后再试。', 429, {'Retry-After': String(burst.retryAfter)});

  let billing: BillingTurn;
  try {
    billing = await beginBillingTurn({userId: input.userId, conversationId: input.conversationId, operation: CHARGE_OPERATION[input.mode], requestId}, {modelKey: modelPlan?.[0]?.key ?? null});
  } catch (error) {
    const chargeError = toChargeError(error);
    if (chargeError) throw new ChatTurnHttpError(chargeError.message, chargeError.status);
    throw error;
  }
  // 相同 requestId 重放：返回同一费用单与同一结果，不再调用模型、不再扣币、不再写消息。
  if (billing.hold.replayed) {
    if (billing.hold.status === 'SETTLED' && billing.hold.messageId) {
      const saved = await db.message.findUnique({where: {id: billing.hold.messageId}, select: {content: true}});
      if (saved) return {mode: input.mode, stream: await replayStream(saved.content, billing, input)};
    }
    if (billing.hold.status === 'HELD') throw new ChatTurnHttpError('这条请求仍在处理中，请稍后查看结果。', 409);
    // RELEASED / UNKNOWN：上次尝试已作废且未产生回复，用新的请求号重新发送即可。
    throw new ChatTurnHttpError('这条请求已结束且没有产生回复，请重新发送。', 409);
  }
  const call = await reserveAiCall(input.userId, input.conversationId, input.mode, modelPlan?.map(model => model.key)); reservedCall = call;
  try {
    if (input.mode === 'SEND') { const userMessage = await createUserMessage(input.conversationId, content); history = await readRecentMessageHistory(input.conversationId, userMessage.id, rules.historyMessages); }
  } catch (error) {
    if (reservedCall) await finishAiCall(reservedCall.id, reservedCall.startedAt, 'FAILED', {}, 'PERSISTENCE_ERROR').catch(() => {});
    await billing.release('PERSISTENCE_ERROR').catch(releaseError => logRouteError('chat charge release', releaseError));
    throw error;
  }
  /**
   * 记忆注入（V3 第 25 章）：摘要在前、事实在后，总预算按 memory.contextBudgetTokens 裁剪。
   * 记忆读失败绝不让聊天失败——降级成不注入，只记一条日志。
   */
  let memoryContext: string | undefined;
  try {
    const recent = (history as Array<{content: string}> | undefined) ?? [];
    const reserved = recent.reduce((sum, item) => sum + item.content.length, 0) + content.length;
    const memory = await buildMemoryContext(input.conversationId, {userId: input.userId, reservedTokens: reserved});
    memoryContext = memory.text ?? undefined;
  } catch (error) {
    logRouteError('chat memory context', error);
  }
  const notice = billing.notice();
  const abort = new AbortController(); let cancelled = false;
  const onAbort = () => { cancelled = true; abort.abort(new DOMException('Client disconnected', 'AbortError')); };
  input.signal.addEventListener('abort', onAbort, {once: true}); if (input.signal.aborted) onAbort();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (notice) emit(controller, 'data: ' + JSON.stringify({cost: {requestId, charged: notice.charged, coins: notice.coins, allowanceSource: notice.allowanceSource, balance: await readBalance(input.userId)}}) + '\n\n', () => cancelled);
      let assistantContent = ''; let failure: unknown; let metrics: AiStreamMetrics = {}; let persistedMessageId: string | null = null;
      try {
        if (usingRealAi) assistantContent = await streamOpenAIResponse(controller, conversation.character, history ?? [], content, conversation.aiModel, {signal: abort.signal, onMetrics: value => { metrics = value; }, providers: configuredProviders, models: modelPlan ?? undefined});
        else assistantContent = await streamMockResponse(controller, conversation.character, content, abort.signal);
      } catch (error) {
        failure = error; logRouteError(input.mode === 'SEND' ? 'POST /api/conversations/[id]/messages' : 'POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
        const message = aiUserError(error) + (input.mode === 'REGENERATE' ? ' 原回复已保留。' : '');
        emit(controller, 'data: ' + JSON.stringify({error: message}) + '\n\n', () => cancelled);
      } finally {
        // 「已输出」以服务端已写出首个内容片段为准：出了片段即计费，未出则释放。
        if (assistantContent) billing.sawOutput();
        const delivered = billing.deliveredOutput();
        try {
          // 失败或首个片段送达前取消：不保存空回复。已输出后取消按已消费处理，保留已显示内容。
          if (input.mode === 'SEND') {
            if (cancelled && !delivered) assistantContent = '';
            if (failure && !delivered) assistantContent = '';
            const saved = await persistAssistantResponse(input.conversationId, conversation.characterId, assistantContent);
            persistedMessageId = saved?.id ?? null;
            // 新消息累计到阈值才登记摘要任务；任务由统一后台入口执行，不在响应后裸跑 Promise。
            if (saved) await enqueueSummaryIfDue(input.conversationId).catch(error => logRouteError('chat memory summary enqueue', error));
          } else if (!failure && (!cancelled || delivered)) {
            const replaced = await replaceMessageReply(input.conversationId, replaceAt!, assistantContent);
            persistedMessageId = replaced?.id ?? null;
          }
          await finishAiCall(call.id, call.startedAt, failure && aiErrorCode(failure) !== 'CANCELLED' ? 'FAILED' : cancelled ? 'CANCELLED' : usingRealAi ? 'SUCCEEDED' : 'MOCK', metrics, failure ? aiErrorCode(failure) : cancelled ? 'CANCELLED' : undefined);
          if (failure || (cancelled && !delivered)) await billing.release(failure ? aiErrorCode(failure) : 'CANCELLED');
          else await billing.settle({messageId: persistedMessageId, aiCallId: call.id});
          const receipt = await readTurnReceipt({userId: input.userId, conversationId: input.conversationId, operation: CHARGE_OPERATION[input.mode], requestId});
          if (receipt && !cancelled) emit(controller, 'data: ' + JSON.stringify({costResult: {...receipt, balance: await readBalance(input.userId)}}) + '\n\n', () => false);
          emit(controller, 'data: [DONE]\n\n', () => cancelled);
        } catch (error) {
          await finishAiCall(call.id, call.startedAt, 'FAILED', metrics, 'PERSISTENCE_ERROR').catch(() => {});
          await billing.release('PERSISTENCE_ERROR').catch(releaseError => logRouteError('chat charge release', releaseError));
          logRouteError(input.mode === 'SEND' ? 'POST /api/conversations/[id]/messages (persistence)' : 'POST /api/conversations/[id]/messages/[messageId]/regenerate (persistence)', error);
          const message = input.mode === 'SEND' ? '聊天记录保存失败，请刷新后确认。' : '回复保存失败，请刷新后确认。';
          emit(controller, 'data: ' + JSON.stringify({error: message}) + '\n\n', () => cancelled);
        } finally { input.signal.removeEventListener('abort', onAbort); if (!cancelled) controller.close(); }
      }
    },
    cancel() { onAbort(); },
  });
  return {mode: input.mode, stream};
}

export {AiQuotaError, ConversationError, ConversationMessageError};