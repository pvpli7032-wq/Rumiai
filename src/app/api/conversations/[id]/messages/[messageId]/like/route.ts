import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

/**
 * The thumbs-up under a reply. Stored on the message rather than counted, because it is
 * the reader's own mark on their own conversation — one flag, not a tally.
 */
async function ownedMessage(conversationId: string, messageId: string, userId: string) {
  const message = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, likedAt: true, conversation: { select: { userId: true } } },
  });
  if (!message || message.conversationId !== conversationId) return { error: 'notFound' as const };
  if (message.conversation.userId !== userId) return { error: 'forbidden' as const };
  return { message };
}

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }
) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedMessage(params.id, params.messageId, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Liking twice keeps the original timestamp and writes nothing.
    if (owned.message.likedAt) {
      return NextResponse.json({ success: true, liked: true, likedAt: owned.message.likedAt });
    }

    const marked = await db.message.update({
      where: { id: params.messageId },
      data: { likedAt: new Date() },
      select: { likedAt: true },
    });
    return NextResponse.json({ success: true, liked: true, likedAt: marked.likedAt });
  } catch (error) {
    logRouteError('POST /api/conversations/[id]/messages/[messageId]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; messageId: string }> }
) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedMessage(params.id, params.messageId, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await db.message.update({ where: { id: params.messageId }, data: { likedAt: null } });
    return NextResponse.json({ success: true, liked: false });
  } catch (error) {
    logRouteError('DELETE /api/conversations/[id]/messages/[messageId]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
