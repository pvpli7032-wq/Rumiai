import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { ConversationError, createOrReuseConversation, listUserConversations, readUserConversationPage } from '@rumiai/backend/modules/conversations/conversation-service';

function conversationError(error: unknown) {
  return error instanceof ConversationError ? NextResponse.json({error: error.message}, {status: error.status}) : null;
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {searchParams} = new URL(request.url);
    if (searchParams.has('limit') || searchParams.has('cursor') || searchParams.has('q')) return NextResponse.json(await readUserConversationPage(auth.userId, {archived: searchParams.get('archived') === 'true', characterId: searchParams.get('characterId'), limit: searchParams.get('limit'), cursor: searchParams.get('cursor'), q: searchParams.get('q')}));
    return NextResponse.json(await listUserConversations(auth.userId, {
      archived: searchParams.get('archived') === 'true',
      characterId: searchParams.get('characterId'),
    }));
  } catch (error) {
    const response = conversationError(error); if (response) return response;
    logRouteError('GET /api/conversations', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '会话数据格式不正确。'}, {status: 400}); }
    return NextResponse.json(await createOrReuseConversation(auth.userId, body), {status: 201});
  } catch (error) {
    const response = conversationError(error);
    if (response) return response;
    logRouteError('POST /api/conversations', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
