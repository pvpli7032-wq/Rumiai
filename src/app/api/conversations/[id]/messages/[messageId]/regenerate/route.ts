import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { isAiChatAvailable } from '@/lib/launch-guards';
import { checkRateLimit } from '@/lib/rate-limit';
import { reserveAiCall, finishAiCall, AiQuotaError } from '@/lib/ai/ai-usage';
import { aiErrorCode, aiUserError } from '@/lib/conversations/chat-stream';
import type { AiStreamMetrics } from '@/lib/ai/types';
import { HISTORY_TURNS, CHAT_LIMIT, CHAT_WINDOW_MS } from '@/lib/ai/config';
import { streamMockResponse, streamOpenAIResponse } from '@/lib/conversations/chat-stream';

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

  let reservedCall:{id:string;startedAt:Date}|undefined;
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await db.conversation.findUnique({
      where: { id: params.id },
      include: { character: true },
    });
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (conversation.userId !== authUser.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if ((!conversation.character.isPublic || conversation.character.reviewStatus !== 'APPROVED') && conversation.character.creatorId !== authUser.userId) return NextResponse.json({ error: '角色已下架或设为私有，无法继续对话。' }, { status: 403 });

    const target = await db.message.findUnique({
      where: { id: params.messageId },
      select: { id: true, conversationId: true, role: true, createdAt: true },
    });
    if (!target || target.conversationId !== params.id) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    // Given a reply, the line being answered is the most recent user message before it.
    // Given a user message, that message *is* the line being answered.
    const prompt =
      target.role === 'USER'
        ? await db.message.findUnique({
            where: { id: target.id },
            select: { id: true, content: true, createdAt: true },
          })
        : await db.message.findFirst({
            where: { conversationId: params.id, role: 'USER', createdAt: { lt: target.createdAt } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, content: true, createdAt: true },
          });
    if (!prompt) {
      return NextResponse.json({ error: 'Nothing to reply to' }, { status: 400 });
    }

    // A failed production provider must never discard the existing reply.
    if (!isAiChatAvailable(process.env)) {
      return NextResponse.json({ error: 'AI 服务未配置，暂时无法重新生成回复。' }, { status: 503 });
    }

    const burst = checkRateLimit(`chat:min:${authUser.userId}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: '发送过快，请稍后再试。' },
        { status: 429, headers: { 'Retry-After': String(burst.retryAfter) } }
      );
    }
    const call = await reserveAiCall(authUser.userId, params.id, 'REGENERATE');
    reservedCall=call;

    // Read only the context before the target user message. Defer deleting the
    // previous reply until after the replacement has successfully completed.
    const recent = await db.message.findMany({
      where: { conversationId: params.id, createdAt: { lt: prompt.createdAt } },
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
              controller, conversation.character, history, prompt.content, conversation.aiModel, {signal:abort.signal,onMetrics:value=>{metrics=value}}
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
            if (assistantContent.trim()) {
              // Atomic replacement: failed upstream calls preserve the original reply.
              await db.$transaction([
                db.message.deleteMany({
                  where: { conversationId: params.id, createdAt: { gt: prompt.createdAt } },
                }),
                db.message.create({
                  data: { conversationId: params.id, role: 'ASSISTANT', content: assistantContent },
                }),
                db.conversation.update({ where: { id: params.id }, data: { updatedAt: new Date() } }),
              ]);
            }
            await finishAiCall(call.id,call.startedAt,failure&&aiErrorCode(failure)!=='CANCELLED'?'FAILED':cancelled?'CANCELLED':process.env.OPENAI_API_KEY?.trim()?'SUCCEEDED':'MOCK',metrics,failure?aiErrorCode(failure):cancelled?'CANCELLED':undefined);
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
    if(error instanceof AiQuotaError)return NextResponse.json({error:error.message},{status:error.status ?? 429,headers:error.retryAfter>0?{'Retry-After':String(error.retryAfter)}:{}});
    if(reservedCall)await finishAiCall(reservedCall.id,reservedCall.startedAt,'FAILED',{},'PERSISTENCE_ERROR').catch(()=>{});
    logRouteError('POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
