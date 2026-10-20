import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { ConversationMessageError, deleteMessageAndFollowing, editUserMessage } from '@/lib/conversations/message-service';
// Composition root wiring: the story side registers its same-transaction history
// invalidation at module load (dependency inversion — conversations never import
// stories). Without this import a story-conversation edit fails closed with 503.
import '@/lib/stories/lifecycle/invalidation';

function messageError(error: unknown) {
  return error instanceof ConversationMessageError ? NextResponse.json({error: error.message}, {status: error.status}) : null;
}

export async function PATCH(request: Request, {params}: {params: Promise<{id: string; messageId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, messageId} = await params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: 'Message data is invalid'}, {status: 400}); }
    return NextResponse.json(await editUserMessage(auth.userId, id, messageId, body));
  } catch (error) {
    const response = messageError(error);
    if (response) return response;
    logRouteError('PATCH /api/conversations/[id]/messages/[messageId]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{id: string; messageId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, messageId} = await params;
    return NextResponse.json(await deleteMessageAndFollowing(auth.userId, id, messageId));
  } catch (error) {
    const response = messageError(error);
    if (response) return response;
    logRouteError('DELETE /api/conversations/[id]/messages/[messageId]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
