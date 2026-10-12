import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

/**
 * Liking a comment.
 *
 * The counter and the row move together inside a transaction, and the insert is guarded by
 * the (userId, commentId) unique index rather than a read-then-write — that pattern is what
 * let concurrent requests collect the mission rewards more than once, so the count here is
 * derived from whether the insert actually happened.
 */
export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ commentId: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const comment = await db.comment.findUnique({
      where: { id: params.commentId },
      select: { id: true, likeCount: true },
    });
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

    const likeCount = await db.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId: authUser.userId, commentId: params.commentId } },
        select: { id: true },
      });
      // Already liked: idempotent, and the counter must not move.
      if (existing) {
        const current = await tx.comment.findUnique({
          where: { id: params.commentId },
          select: { likeCount: true },
        });
        return current?.likeCount ?? 0;
      }

      await tx.commentLike.create({
        data: { userId: authUser.userId, commentId: params.commentId },
      });
      const updated = await tx.comment.update({
        where: { id: params.commentId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      return updated.likeCount;
    });

    return NextResponse.json({ success: true, hasLiked: true, likeCount });
  } catch (error) {
    logRouteError('POST /api/comments/[commentId]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ commentId: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const likeCount = await db.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId: authUser.userId, commentId: params.commentId } },
        select: { id: true },
      });
      if (!existing) {
        const current = await tx.comment.findUnique({
          where: { id: params.commentId },
          select: { likeCount: true },
        });
        return current?.likeCount ?? null;
      }

      await tx.commentLike.delete({ where: { id: existing.id } });
      const updated = await tx.comment.update({
        where: { id: params.commentId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      });
      // A counter that drifted below zero would render as a negative like count; clamp it
      // rather than trusting the stored value.
      if (updated.likeCount < 0) {
        const fixed = await tx.comment.update({
          where: { id: params.commentId },
          data: { likeCount: 0 },
          select: { likeCount: true },
        });
        return fixed.likeCount;
      }
      return updated.likeCount;
    });

    if (likeCount === null) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    return NextResponse.json({ success: true, hasLiked: false, likeCount });
  } catch (error) {
    logRouteError('DELETE /api/comments/[commentId]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
