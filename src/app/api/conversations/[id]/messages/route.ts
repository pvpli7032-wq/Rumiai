import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { ConversationMessageError, readConversationMessages } from '@/lib/conversations/message-service';
import { getAuthUser } from '@/lib/auth';
import { AiQuotaError, ChatTurnHttpError, ConversationError, executeChatTurn } from '@/lib/conversations/chat-application-service';

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
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const result = await executeChatTurn({userId: authUser.userId, conversationId: params.id, mode: 'SEND', input: {request}, signal: request.signal});
    return new Response(result.stream, {headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'}});
  } catch (error) {
    if (error instanceof ChatTurnHttpError) return NextResponse.json({error: error.message}, {status: error.status, headers: error.headers});
    if (error instanceof ConversationError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof ConversationMessageError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof AiQuotaError) return NextResponse.json({error: error.message}, {status: error.status ?? 429, headers: error.retryAfter > 0 ? {'Retry-After': String(error.retryAfter)} : {}});
    logRouteError('POST /api/conversations/[id]/messages', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
