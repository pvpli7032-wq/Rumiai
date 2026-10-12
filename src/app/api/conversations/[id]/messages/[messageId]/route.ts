import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

const MAX_CONTENT = 4_000;

async function ownedMessage(conversationId: string, messageId: string, userId: string) {
  const message = await db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      role: true,
      createdAt: true,
      conversation: { select: { userId: true } },
    },
  });
  if (!message || message.conversationId !== conversationId) return { error: 'notFound' as const };
  if (message.conversation.userId !== userId) return { error: 'forbidden' as const };
  return { message };
}

/**
 * Reword something you said.
 *
 * Editing only makes sense for your own line: rewriting what the character said would let
 * a reader put words in its mouth and then have the model treat them as its own history.
 *
 * The reply that followed is deleted, because it answered the old wording. The client then
 * regenerates, so the thread stays consistent instead of showing an answer to a question
 * that is no longer on screen.
 */
export async function PATCH(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }
) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedMessage(params.id, params.messageId, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (owned.message.role !== 'USER') {
      return NextResponse.json({ error: 'Only your own message can be edited' }, { status: 400 });
    }

    const body = await request.json();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ error: `content must be ${MAX_CONTENT} characters or fewer` }, { status: 400 });
    }

    const [message, dropped] = await db.$transaction([
      db.message.update({
        where: { id: params.messageId },
        data: { content },
        select: { id: true, role: true, content: true, likedAt: true, createdAt: true },
      }),
      db.message.deleteMany({
        where: { conversationId: params.id, createdAt: { gt: owned.message.createdAt } },
      }),
    ]);

    return NextResponse.json({ message, droppedReplies: dropped.count });
  } catch (error) {
    logRouteError('PATCH /api/conversations/[id]/messages/[messageId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Remove a message, and anything that followed from it. */
export async function DELETE(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }
) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedMessage(params.id, params.messageId, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const removed = await db.message.deleteMany({
      where: { conversationId: params.id, createdAt: { gte: owned.message.createdAt } },
    });

    return NextResponse.json({ success: true, removed: removed.count });
  } catch (error) {
    logRouteError('DELETE /api/conversations/[id]/messages/[messageId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
