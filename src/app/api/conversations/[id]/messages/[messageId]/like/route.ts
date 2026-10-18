import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { ConversationMessageError, setMessageLiked } from '@/lib/conversations/message-service';

function messageError(error: unknown) {
  return error instanceof ConversationMessageError ? NextResponse.json({error: error.message}, {status: error.status}) : null;
}

export async function POST(request: Request, {params}: {params: Promise<{id: string; messageId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, messageId} = await params;
    return NextResponse.json(await setMessageLiked(auth.userId, id, messageId, true));
  } catch (error) {
    const response = messageError(error);
    if (response) return response;
    logRouteError('POST /api/conversations/[id]/messages/[messageId]/like', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{id: string; messageId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, messageId} = await params;
    return NextResponse.json(await setMessageLiked(auth.userId, id, messageId, false));
  } catch (error) {
    const response = messageError(error);
    if (response) return response;
    logRouteError('DELETE /api/conversations/[id]/messages/[messageId]/like', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
