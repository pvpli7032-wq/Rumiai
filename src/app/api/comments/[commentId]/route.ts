import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

const MAX_BODY = 2_000;

async function ownedComment(commentId: string, userId: string) {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, characterId: true, hiddenAt: true },
  });
  if (!comment) return { error: 'notFound' as const };
  if (comment.authorId !== userId) return { error: 'forbidden' as const };
  return { comment };
}

/** Reword your own comment. */
export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ commentId: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedComment(params.commentId, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const requestBody = await request.json();
    const body = typeof requestBody.body === 'string' ? requestBody.body.trim() : '';
    if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });
    if (body.length > MAX_BODY) {
      return NextResponse.json({ error: `body must be ${MAX_BODY} characters or fewer` }, { status: 400 });
    }

    const comment = await db.comment.update({
      where: { id: params.commentId },
      data: { body },
      select: { id: true, body: true, likeCount: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({ comment });
  } catch (error) {
    logRouteError('PATCH /api/comments/[commentId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Delete your own comment.
 *
 * The character's creator can also delete comments on their own character — they are
 * responsible for what sits on their page, and waiting on a moderator to clear something
 * off it is not a reasonable position to put them in.
 */
export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ commentId: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const comment = await db.comment.findUnique({
      where: { id: params.commentId },
      select: {
        id: true,
        authorId: true,
        character: { select: { creatorId: true } },
      },
    });
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

    const isAuthor = comment.authorId === authUser.userId;
    const isHost = comment.character.creatorId === authUser.userId;
    if (!isAuthor && !isHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Replies cascade with the row, per the schema relation.
    await db.comment.delete({ where: { id: params.commentId } });

    return NextResponse.json({ success: true, deletedBy: isAuthor ? 'author' : 'creator' });
  } catch (error) {
    logRouteError('DELETE /api/comments/[commentId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
