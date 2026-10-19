import { logRouteError } from '@/lib/logger';
import { ConversationError, readConversationForChat } from '@/lib/conversations/conversation-service';
import { ConversationMessageError, createUserMessage, prepareMessageRegeneration, readRecentMessageHistory, persistAssistantResponse, replaceMessageReply } from '@/lib/conversations/message-service';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError, streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import {readActiveAiProviders} from '@/lib/ai/providers/management-service';
import {readAiModelPlan} from '@/lib/ai/models/runtime-service';

export type ChatTurnMode = 'SEND' | 'REGENERATE';
export type ChatTurnInput = {request: Request} | {targetMessageId: string};
export interface ChatTurnRequest { userId: string; conversationId: string; mode: ChatTurnMode; input: ChatTurnInput; signal: AbortSignal; }
export interface ChatTurnResult { mode: ChatTurnMode; stream: ReadableStream<Uint8Array>; }
export class ChatTurnHttpError extends Error { constructor(message: string, readonly status: number, readonly headers?: HeadersInit) { super(message); this.name = 'ChatTurnHttpError'; } }
function emit(controller: ReadableStreamDefaultController<Uint8Array>, data: string, cancelled: () => boolean) { if (cancelled()) return; try { controller.enqueue(new TextEncoder().encode(data)); } catch { /* disconnected */ } }

export async function executeChatTurn(input: ChatTurnRequest): Promise<ChatTurnResult> {
  let reservedCall: {id: string; startedAt: Date} | undefined;
  let usingRealAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const conversation = await readConversationForChat(input.userId, input.conversationId);
  let content: string; let history: Awaited<ReturnType<typeof readRecentMessageHistory>>; let replaceAt: Date | undefined;
  if (input.mode === 'SEND') {
    if (!('request' in input.input)) throw new ChatTurnHttpError('消息数据格式不正确。', 400);
    let body: unknown;
    try { body = await input.input.request.json(); } catch { throw new ChatTurnHttpError('消息数据格式不正确。', 400); }
    const raw = (body as {content?: unknown} | null)?.content;
    if (typeof raw !== 'string' || raw.length > 5000) throw new ChatTurnHttpError('消息须为文本，最多 5000 字。', 400);
    if (!raw.trim()) throw new ChatTurnHttpError('Message content is required', 400);
    content = raw.trim();
  } else {
    if (!('targetMessageId' in input.input)) throw new ChatTurnHttpError('Internal server error', 500);
    const prepared = await prepareMessageRegeneration(input.userId, input.conversationId, input.input.targetMessageId, HISTORY_TURNS);
    content = prepared.prompt.content; history = prepared.history; replaceAt = prepared.prompt.createdAt;
  }
  const modelPlan = await readAiModelPlan(conversation.aiModel, conversation.characterId);
  if (modelPlan?.length === 0) throw new ChatTurnHttpError('当前角色暂无可用模型，请重新选择模型或联系管理员。', 503);
  const configuredProviders = modelPlan === null ? await readActiveAiProviders() : [];
  usingRealAi = usingRealAi || configuredProviders.length > 0 || Boolean(modelPlan?.length);
  if (!isAiChatAvailable({...process.env, OPENAI_API_KEY: usingRealAi ? 'configured' : ''})) throw new ChatTurnHttpError(input.mode === 'SEND' ? 'AI 服务未配置，暂时无法聊天。' : 'AI 服务未配置，暂时无法重新生成回复。', 503);
  const burst = checkRateLimit('chat:min:' + input.userId, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!burst.allowed) throw new ChatTurnHttpError('发送过快，请稍后再试。', 429, {'Retry-After': String(burst.retryAfter)});
  const call = await reserveAiCall(input.userId, input.conversationId, input.mode, modelPlan?.map(model => model.key)); reservedCall = call;
  try {
    if (input.mode === 'SEND') { const userMessage = await createUserMessage(input.conversationId, content); history = await readRecentMessageHistory(input.conversationId, userMessage.id, HISTORY_TURNS); }
  } catch (error) {
    if (reservedCall) await finishAiCall(reservedCall.id, reservedCall.startedAt, 'FAILED', {}, 'PERSISTENCE_ERROR').catch(() => {});
    throw error;
  }
  const abort = new AbortController(); let cancelled = false;
  const onAbort = () => { cancelled = true; abort.abort(new DOMException('Client disconnected', 'AbortError')); };
  input.signal.addEventListener('abort', onAbort, {once: true}); if (input.signal.aborted) onAbort();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantContent = ''; let failure: unknown; let metrics: AiStreamMetrics = {};
      try {
        if (usingRealAi) assistantContent = await streamOpenAIResponse(controller, conversation.character, history ?? [], content, conversation.aiModel, {signal: abort.signal, onMetrics: value => { metrics = value; }, providers: configuredProviders, models: modelPlan ?? undefined});
        else assistantContent = await streamMockResponse(controller, conversation.character, content, abort.signal);
      } catch (error) {
        failure = error; logRouteError(input.mode === 'SEND' ? 'POST /api/conversations/[id]/messages' : 'POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
        const message = aiUserError(error) + (input.mode === 'REGENERATE' ? ' 原回复已保留。' : '');
        emit(controller, 'data: ' + JSON.stringify({error: message}) + '\n\n', () => cancelled);
      } finally {
        try {
          if (cancelled) assistantContent = '';
          if (input.mode === 'SEND') await persistAssistantResponse(input.conversationId, conversation.characterId, assistantContent);
          else if (!failure && !cancelled) await replaceMessageReply(input.conversationId, replaceAt!, assistantContent);
          await finishAiCall(call.id, call.startedAt, failure && aiErrorCode(failure) !== 'CANCELLED' ? 'FAILED' : cancelled ? 'CANCELLED' : usingRealAi ? 'SUCCEEDED' : 'MOCK', metrics, failure ? aiErrorCode(failure) : cancelled ? 'CANCELLED' : undefined);
          emit(controller, 'data: [DONE]\n\n', () => cancelled);
        } catch (error) {
          await finishAiCall(call.id, call.startedAt, 'FAILED', metrics, 'PERSISTENCE_ERROR').catch(() => {});
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
