import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { ConversationError, readConversationForChat } from '@/lib/conversations/conversation-service';
import { ConversationMessageError, prepareMessageRegeneration, replaceMessageReply } from '@/lib/conversations/message-service';
import { getAuthUser } from '@/lib/auth';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import { streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';
import {readActiveAiProviders} from '@/lib/ai/providers/management-service';
import {readAiModelPlan} from '@/lib/ai/models/runtime-service';

/**
 * Ask for a different reply.
 *
 * The target may be either the reply to replace, or the reader's own line to answer again
 * — the edit flow needs the second form, because after rewording a message its old answer
 * is gone and a fresh one has to be generated without creating a duplicate message.
 *
 * Either way the superseded reply is deleted before the new one streams, so the history
 * the model sees never contains the answer it is being asked to replace — otherwise it
 * tends to repeat itself, or worse, react to its own discarded line as if the reader had
 * said it.
 *
 * A regeneration costs a full model call, so it goes through the same burst and daily
 * limits as a new message. Without that, a reader holding down "regenerate" could spend
 * the platform's shared daily quota without ever sending a message.
 */
export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }
) {
  const params = await paramsPromise;

  let reservedCall:{id:string;startedAt:Date}|undefined;let usingRealAi=Boolean(process.env.OPENAI_API_KEY?.trim());
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await readConversationForChat(authUser.userId, params.id);
    const {prompt, history} = await prepareMessageRegeneration(authUser.userId, params.id, params.messageId, HISTORY_TURNS);

    // A failed production provider must never discard the existing reply.
    const modelPlan=await readAiModelPlan(conversation.aiModel,conversation.characterId);if(modelPlan?.length===0)return NextResponse.json({error:'当前角色暂无可用模型，请重新选择模型或联系管理员。'},{status:503});
    const configuredProviders=modelPlan===null?await readActiveAiProviders():[];usingRealAi=usingRealAi||configuredProviders.length>0||Boolean(modelPlan?.length);
    if (!isAiChatAvailable({...process.env,OPENAI_API_KEY:usingRealAi?'configured':''})) {
      return NextResponse.json({ error: 'AI 服务未配置，暂时无法重新生成回复。' }, { status: 503 });
    }

    const burst = checkRateLimit(`chat:min:${authUser.userId}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: '发送过快，请稍后再试。' },
        { status: 429, headers: { 'Retry-After': String(burst.retryAfter) } }
      );
    }
    const call = await reserveAiCall(authUser.userId, params.id, 'REGENERATE', modelPlan?.map(model=>model.key));
    reservedCall=call;

    // Read only the context before the target user message. Defer deleting the
    // previous reply until after the replacement has successfully completed.
    const abort=new AbortController();let cancelled=false;
    const onAbort=()=>{cancelled=true;abort.abort(new DOMException('Client disconnected','AbortError'));};
    request.signal.addEventListener('abort',onAbort,{once:true});
    if(request.signal.aborted)onAbort();
    const stream = new ReadableStream({
      async start(controller) {
        let assistantContent = '';
        let failure:unknown;let metrics:AiStreamMetrics={};
        const emit=(data:string)=>{if(cancelled)return;try{controller.enqueue(new TextEncoder().encode(data));}catch{onAbort();}};
        try {
          if (usingRealAi) {
            assistantContent = await streamOpenAIResponse(
              controller, conversation.character, history, prompt.content, conversation.aiModel, {signal:abort.signal,onMetrics:value=>{metrics=value},providers:configuredProviders,models:modelPlan??undefined}
            );
          } else {
            assistantContent = await streamMockResponse(controller, conversation.character, prompt.content, abort.signal);
          }
        } catch (error) {
          failure=error;
          logRouteError('POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
          emit(`data: ${JSON.stringify({error:aiUserError(error)+' 原回复已保留。'})}\n\n`);
        } finally {
          try {
            if(cancelled)assistantContent='';
            // The service replaces the reply atomically and leaves the original intact on failure or cancellation.
            await replaceMessageReply(params.id, prompt.createdAt, assistantContent);
            await finishAiCall(call.id,call.startedAt,failure&&aiErrorCode(failure)!=='CANCELLED'?'FAILED':cancelled?'CANCELLED':usingRealAi?'SUCCEEDED':'MOCK',metrics,failure?aiErrorCode(failure):cancelled?'CANCELLED':undefined);
            emit('data: [DONE]\n\n');
          } catch (error) {
            await finishAiCall(call.id,call.startedAt,'FAILED',metrics,'PERSISTENCE_ERROR').catch(()=>{});
            logRouteError('POST /api/conversations/[id]/messages/[messageId]/regenerate (persistence)', error);
            emit(`data: ${JSON.stringify({error:'回复保存失败，请刷新后确认。'})}\n\n`);
          } finally {
            request.signal.removeEventListener('abort',onAbort);
            if(!cancelled)controller.close();
          }
        }
      },
      cancel(){onAbort();},
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof ConversationError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof ConversationMessageError) return NextResponse.json({error: error.message}, {status: error.status});
    if(error instanceof AiQuotaError)return NextResponse.json({error:error.message},{status:error.status ?? 429,headers:error.retryAfter>0?{'Retry-After':String(error.retryAfter)}:{}});
    if(reservedCall)await finishAiCall(reservedCall.id,reservedCall.startedAt,'FAILED',{},'PERSISTENCE_ERROR').catch(()=>{});
    logRouteError('POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
