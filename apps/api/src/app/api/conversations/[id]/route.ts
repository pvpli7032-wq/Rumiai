import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import {readRelationshipPolicy, readRelationshipHistory} from '@rumiai/backend/modules/conversations/relationship-service';
import { ConversationError, deleteConversation, readConversation, updateConversation } from '@rumiai/backend/modules/conversations/conversation-service';

function conversationError(error: unknown) {
  return error instanceof ConversationError ? NextResponse.json({error: error.message}, {status: error.status}) : null;
}

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const result = await readConversation(auth.userId, (await params).id);
    return NextResponse.json({...result, relationshipPolicy: await readRelationshipPolicy(), relationshipHistory: await readRelationshipHistory((await params).id)}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    const response = conversationError(error);
    if (response) return response;
    logRouteError('GET /api/conversations/[id]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '会话数据格式不正确。'}, {status: 400}); }
    const result = await updateConversation(auth.userId, (await params).id, body);
    return NextResponse.json({...result, relationshipPolicy: await readRelationshipPolicy(), relationshipHistory: await readRelationshipHistory((await params).id)}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    const response = conversationError(error);
    if (response) return response;
    logRouteError('PATCH /api/conversations/[id]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await deleteConversation(auth.userId, (await params).id));
  } catch (error) {
    const response = conversationError(error);
    if (response) return response;
    logRouteError('DELETE /api/conversations/[id]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
