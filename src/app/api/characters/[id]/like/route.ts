import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/user-identity';

/**
 * Like a character. Idempotent: liking twice leaves one row and one count, because the
 * like is a row keyed by (user, character) rather than a bare counter — a counter alone
 * would let the same account inflate it indefinitely.
 */
export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const character = await db.character.findUnique({
      where: { id: params.id },
      select: { id: true, isPublic: true, reviewStatus: true, creatorId: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    let likeCount: number;
    try {
      const result = await db.$transaction(async tx => {
        await tx.characterLike.create({
          data: { userId: authUser.userId, characterId: character.id },
        });
        const updated = await tx.character.update({
          where: { id: character.id },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        });
        return updated.likeCount;
      });
      likeCount = result;
    } catch (error) {
      // Already liked — report the current state rather than an error.
      if (!isUniqueViolation(error)) throw error;
      const current = await db.character.findUnique({
        where: { id: character.id },
        select: { likeCount: true },
      });
      likeCount = current?.likeCount ?? 0;
    }

    return NextResponse.json({ success: true, hasLiked: true, likeCount });
  } catch (error) {
    logRouteError('POST /api/characters/[id]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Remove a like. Also idempotent: un-liking twice is not an error. */
export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const likeCount = await db.$transaction(async tx => {
      const removed = await tx.characterLike.deleteMany({
        where: { userId: authUser.userId, characterId: params.id },
      });
      if (removed.count === 0) {
        const current = await tx.character.findUnique({
          where: { id: params.id },
          select: { likeCount: true },
        });
        return current?.likeCount ?? null;
      }
      // Never let the cached counter go negative if it has drifted.
      const updated = await tx.character.update({
        where: { id: params.id },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      });
      if (updated.likeCount < 0) {
        const fixed = await tx.character.update({
          where: { id: params.id },
          data: { likeCount: 0 },
          select: { likeCount: true },
        });
        return fixed.likeCount;
      }
      return updated.likeCount;
    });

    if (likeCount === null) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    return NextResponse.json({ success: true, hasLiked: false, likeCount });
  } catch (error) {
    logRouteError('DELETE /api/characters/[id]/like', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
