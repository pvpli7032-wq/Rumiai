import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/user-identity';

/**
 * Collect a character quest's reward, once.
 *
 * Claiming is separated from paying out, and the claim is a conditional update backed by
 * the (userId, questId) unique index. The platform-wide missions originally used
 * check-then-write here and concurrent requests each collected the reward; this avoids
 * repeating that.
 */
export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; questId: string }> }
) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const quest = await db.characterQuest.findUnique({
      where: { id: params.questId },
      select: { id: true, characterId: true, title: true, rewardCoins: true, isActive: true },
    });
    if (!quest || quest.characterId !== params.id) {
      return NextResponse.json({ error: 'Quest not found' }, { status: 404 });
    }
    if (!quest.isActive) return NextResponse.json({ error: 'Quest is not active' }, { status: 409 });

    const newBalance = await db.$transaction(async tx => {
      // Keep the claim, balance credit and ledger row together. A failure in any
      // one step rolls back the whole reward, so a completed quest cannot lose it.
      const claimed = await tx.userCharacterQuest.updateMany({
        where: { userId: authUser.userId, questId: quest.id, isCompleted: false },
        data: { isCompleted: true, completedAt: new Date() },
      });

      if (claimed.count === 0) {
        try {
          await tx.userCharacterQuest.create({
            data: { userId: authUser.userId, questId: quest.id, isCompleted: true, completedAt: new Date() },
          });
        } catch (error) {
          if (isUniqueViolation(error)) return null;
          throw error;
        }
      }

      await tx.user.update({
        where: { id: authUser.userId },
        data: { coins: { increment: quest.rewardCoins } },
      });
      await tx.coinTransaction.create({
        data: {
          userId: authUser.userId,
          amount: quest.rewardCoins,
          type: 'EARNED',
          description: `ภารกิจตัวละคร: ${quest.title}`,
        },
      });
      const user = await tx.user.findUnique({ where: { id: authUser.userId }, select: { coins: true } });
      return user?.coins ?? null;
    }, { maxWait: 10_000, timeout: 15_000 });

    if (newBalance === null) {
      return NextResponse.json({ error: 'Quest already completed' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      coinsEarned: quest.rewardCoins,
      newBalance,
    });
  } catch (error) {
    logRouteError('POST /api/characters/[id]/quests/[questId]/complete', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
