import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/user-identity';

/** Bookmark a character. Idempotent, and private characters stay off-limits. */
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

    try {
      await db.characterBookmark.create({
        data: { userId: authUser.userId, characterId: character.id },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    return NextResponse.json({ success: true, hasBookmarked: true });
  } catch (error) {
    logRouteError('POST /api/characters/[id]/bookmark', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await db.characterBookmark.deleteMany({
      where: { userId: authUser.userId, characterId: params.id },
    });

    return NextResponse.json({ success: true, hasBookmarked: false });
  } catch (error) {
    logRouteError('DELETE /api/characters/[id]/bookmark', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
