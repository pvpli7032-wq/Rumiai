import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { AiQuotaError, ChatTurnHttpError, ConversationError, ConversationMessageError, executeChatTurn } from '@/lib/conversations/chat-application-service';

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }) {
  const params = await paramsPromise;
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    // 重新生成同样要带请求号（V3 §20）：一次点击一个编号，重试沿用同一个。
    const body = await request.clone().json().catch(() => null) as {requestId?: unknown} | null;
    const result = await executeChatTurn({userId: authUser.userId, conversationId: params.id, mode: 'REGENERATE', input: {targetMessageId: params.messageId, requestId: body?.requestId}, signal: request.signal});
    return new Response(result.stream, {headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'}});
  } catch (error) {
    if (error instanceof ChatTurnHttpError) return NextResponse.json({error: error.message}, {status: error.status, headers: error.headers});
    if (error instanceof ConversationError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof ConversationMessageError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof AiQuotaError) return NextResponse.json({error: error.message}, {status: error.status ?? 429, headers: error.retryAfter > 0 ? {'Retry-After': String(error.retryAfter)} : {}});
    logRouteError('POST /api/conversations/[id]/messages/[messageId]/regenerate', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}