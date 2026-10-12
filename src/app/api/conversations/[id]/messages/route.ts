import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { getAuthUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import { streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await db.conversation.findUnique({ where: { id: params.id } });
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (conversation.userId !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const messages = await db.message.findMany({
      where: { conversationId: params.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, likedAt: true, imageUrl: true, createdAt: true },
    });
    return NextResponse.json(messages);
  } catch (error) {
    logRouteError('GET /api/conversations/[id]/messages', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  let reservedCall:{id:string;startedAt:Date}|undefined;
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await db.conversation.findUnique({
      where: { id: params.id },
      include: { character: true },
    });
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (conversation.userId !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if ((!conversation.character.isPublic || conversation.character.reviewStatus !== 'APPROVED') && conversation.character.creatorId !== authUser.userId) return NextResponse.json({ error: '角色已下架或设为私有，无法继续对话。' }, { status: 403 });

    let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:'消息数据格式不正确。'},{status:400});}
    const content=(body as {content?:unknown}|null)?.content;
    if(typeof content!=='string'||content.length>5000)return NextResponse.json({error:'消息须为文本，最多 5000 字。'},{status:400});
    if (!content.trim()) return NextResponse.json({ error: 'Message content is required' }, { status: 400 });

    // Do not store a user message or spend their quota if production AI is unavailable.
    if (!isAiChatAvailable(process.env)) {
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
    const call = await reserveAiCall(authUser.userId, params.id, 'SEND');
    reservedCall=call;

    const userMessage = await db.message.create({
      data: { conversationId: params.id, role: 'USER', content: content.trim() },
    });

    // Take the most RECENT turns: ordering ascending with `take` returned the
    // oldest 20 messages instead, so past 20 messages a character was still being
    // told only how the conversation opened and never learned what was just said.
    // The message saved above is excluded because it is appended separately —
    // including it sent the user's line to the model twice.
    const recent = await db.message.findMany({
      where: { conversationId: params.id, id: { not: userMessage.id } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: { role: true, content: true },
    });
    const history = recent.reverse();

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
          if (process.env.OPENAI_API_KEY?.trim()) {
            assistantContent = await streamOpenAIResponse(
              controller, conversation.character, history, content.trim(), conversation.aiModel, {signal:abort.signal,onMetrics:value=>{metrics=value}}
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
            if (assistantContent.trim()) {
              await db.message.create({ data: { conversationId: params.id, role: 'ASSISTANT', content: assistantContent } });
            }
            await db.conversation.update({ where: { id: params.id }, data: { updatedAt: new Date() } });
            await db.character.update({
              where: { id: conversation.characterId },
              data: { messageCount: { increment: assistantContent.trim() ? 2 : 1 } },
            });
            // Finish only after persistence; the client reloads history on [DONE].
            await finishAiCall(call.id,call.startedAt,failure&&aiErrorCode(failure)!=='CANCELLED'?'FAILED':cancelled?'CANCELLED':process.env.OPENAI_API_KEY?.trim()?'SUCCEEDED':'MOCK',metrics,failure?aiErrorCode(failure):cancelled?'CANCELLED':undefined);
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
    if(error instanceof AiQuotaError)return NextResponse.json({error:error.message},{status:429,headers:{'Retry-After':String(error.retryAfter)}});
    if(reservedCall)await finishAiCall(reservedCall.id,reservedCall.startedAt,'FAILED',{},'PERSISTENCE_ERROR').catch(()=>{});
    logRouteError('POST /api/conversations/[id]/messages', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
