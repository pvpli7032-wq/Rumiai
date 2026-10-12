import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * A character's own quests, shown as "ภารกิจ (4)" on the detail dialog. The existing
 * Mission model is platform-wide; these belong to one character, and each reader's
 * completion is tracked separately.
 */
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);

    const character = await db.character.findUnique({
      where: { id: params.id },
      select: { id: true, isPublic: true, reviewStatus: true, creatorId: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser?.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const quests = await db.characterQuest.findMany({
      where: { characterId: params.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, description: true, rewardCoins: true, sortOrder: true },
    });

    // Anonymous readers see the list without progress rather than being refused.
    const progress = authUser
      ? await db.userCharacterQuest.findMany({
          where: { userId: authUser.userId, questId: { in: quests.map(q => q.id) } },
          select: { questId: true, isCompleted: true, completedAt: true },
        })
      : [];
    const byQuest = new Map(progress.map(p => [p.questId, p]));

    return NextResponse.json(
      quests.map(quest => ({
        ...quest,
        isCompleted: byQuest.get(quest.id)?.isCompleted ?? false,
        completedAt: byQuest.get(quest.id)?.completedAt ?? null,
      }))
    );
  } catch (error) {
    logRouteError('GET /api/characters/[id]/quests', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_REWARD = 10_000;
const MAX_QUESTS_PER_CHARACTER = 50;

/** Authoring a quest belongs to the character's creator, nobody else. */
export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const character = await db.character.findUnique({
      where: { id: params.id },
      select: { id: true, creatorId: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if (character.creatorId !== authUser.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `title must be ${MAX_TITLE} characters or fewer` }, { status: 400 });
    }

    const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESCRIPTION) : null;
    const rawReward = body.rewardCoins ?? body.reward_coins;
    const rewardCoins =
      typeof rawReward === 'number' && Number.isFinite(rawReward)
        ? Math.min(MAX_REWARD, Math.max(0, Math.round(rawReward)))
        : 0;

    // A cap keeps one character from becoming an unbounded coin faucet.
    const existing = await db.characterQuest.count({ where: { characterId: params.id } });
    if (existing >= MAX_QUESTS_PER_CHARACTER) {
      return NextResponse.json(
        { error: `A character may have at most ${MAX_QUESTS_PER_CHARACTER} quests` },
        { status: 409 }
      );
    }

    const quest = await db.characterQuest.create({
      data: { characterId: params.id, title, description, rewardCoins, sortOrder: existing },
      select: { id: true, title: true, description: true, rewardCoins: true, sortOrder: true, isActive: true },
    });

    return NextResponse.json({ quest }, { status: 201 });
  } catch (error) {
    logRouteError('POST /api/characters/[id]/quests', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
