import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { ConversationMessageError, readConversationMessagePage, readConversationMessages } from '@rumiai/backend/modules/conversations/message-service';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { AiQuotaError, ChatTurnHttpError, ConversationError, executeChatTurn } from '@rumiai/backend/modules/conversations/chat-application-service';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // 迁移期两种模式并存（规划书 §21）：不传 limit 的旧调用方继续拿完整数组，
    // 显式要分页的新前端拿 {messages, hasMore, nextCursor}，不会突然收到不同结构。
    const {searchParams} = new URL(request.url);
    const paged = searchParams.has('limit') || searchParams.has('before');
    if (!paged) {
      const messages = await readConversationMessages(authUser.userId, params.id);
      return NextResponse.json(messages);
    }
    const page = await readConversationMessagePage(authUser.userId, params.id, {
      limit: searchParams.get('limit'), before: searchParams.get('before'),
    });
    return NextResponse.json(page);
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
