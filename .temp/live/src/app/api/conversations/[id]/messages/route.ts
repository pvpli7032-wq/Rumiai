import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { ConversationError, readConversationForChat } from '@/lib/conversations/conversation-service';
import { ConversationMessageError, createUserMessage, readConversationMessages, readRecentMessageHistory, persistAssistantResponse } from '@/lib/conversations/message-service';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { getAuthUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import { streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';
import {readActiveAiProviders} from '@/lib/ai/providers/management-service';
import {readAiModelPlan} from '@/lib/ai/models/runtime-service';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const messages = await readConversationMessages(authUser.userId, params.id);
    return NextResponse.json(messages);
  } catch (error) {
    const accessError = error instanceof ConversationMessageError ? error : null;
    if (accessError) return NextResponse.json({error: accessError.message}, {status: accessError.status});
    logRouteError('GET /api/conversations/[id]/messages', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  let reservedCall:{id:string;startedAt:Date}|undefined;let usingRealAi=Boolean(process.env.OPENAI_API_KEY?.trim());
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await readConversationForChat(authUser.userId, params.id);

    let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:'消息数据格式不正确。'},{status:400});}
    const content=(body as {content?:unknown}|null)?.content;
    if(typeof content!=='string'||content.length>5000)return NextResponse.json({error:'消息须为文本，最多 5000 字。'},{status:400});
    if (!content.trim()) return NextResponse.json({ error: 'Message content is required' }, { status: 400 });

    // Do not store a user message or spend their quota if production AI is unavailable.
    const modelPlan=await readAiModelPlan(conversation.aiModel,conversation.characterId);if(modelPlan?.length===0)return NextResponse.json({error:'当前角色暂无可用模型，请重新选择模型或联系管理员。'},{status:503});
    const configuredProviders=modelPlan===null?await readActiveAiProviders():[];usingRealAi=usingRealAi||configuredProviders.length>0||Boolean(modelPlan?.length);
    if (!isAiChatAvailable({...process.env,OPENAI_API_KEY:usingRealAi?'configured':''})) {
      return NextResponse.json({ error: 'AI 服务未配置，暂时无法聊天。' }, { status: 503 });
    }

    // Checked after validation so a malformed request does not consume quota.
    const burst = checkRateLimit(`chat:min:${authUser.userId}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: '发送过快，请稍后再试。' },
        { status: 429, headers: { 'Retry-After': String(burst.retryAfter) } }
      );
    }
    const call = await reserveAiCall(authUser.userId, params.id, 'SEND', modelPlan?.map(model=>model.key));
    reservedCall=call;

    const userMessage = await createUserMessage(params.id, content.trim());

    // Take the most RECENT turns: ordering ascending with `take` returned the
    // oldest 20 messages instead, so past 20 messages a character was still being
    // told only how the conversation opened and never learned what was just said.
    // The message saved above is excluded because it is appended separately —
    // including it sent the user's line to the model twice.
    const history = await readRecentMessageHistory(params.id, userMessage.id, HISTORY_TURNS);

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
              controller, conversation.character, history, content.trim(), conversation.aiModel, {signal:abort.signal,onMetrics:value=>{metrics=value},providers:configuredProviders,models:modelPlan??undefined}
            );
          } else {
            assistantContent = await streamMockResponse(controller, conversation.character, content.trim(), abort.signal);
          }
        } catch (error) {
          failure=error;
          logRouteError('POST /api/conversations/[id]/messages', error);
          emit(`data: ${JSON.stringify({error:aiUserError(error)})}\n\n`);
        } finally {
          try {
            if(cancelled)assistantContent='';
            await persistAssistantResponse(params.id, conversation.characterId, assistantContent);
            // Finish only after persistence; the client reloads history on [DONE].
            await finishAiCall(call.id,call.startedAt,failure&&aiErrorCode(failure)!=='CANCELLED'?'FAILED':cancelled?'CANCELLED':usingRealAi?'SUCCEEDED':'MOCK',metrics,failure?aiErrorCode(failure):cancelled?'CANCELLED':undefined);
            emit('data: [DONE]\n\n');
          } catch (error) {
            await finishAiCall(call.id,call.startedAt,'FAILED',metrics,'PERSISTENCE_ERROR').catch(()=>{});
            logRouteError('POST /api/conversations/[id]/messages (persistence)', error);
            emit(`data: ${JSON.stringify({error:'聊天记录保存失败，请刷新后确认。'})}\n\n`);
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
    logRouteError('POST /api/conversations/[id]/messages', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
