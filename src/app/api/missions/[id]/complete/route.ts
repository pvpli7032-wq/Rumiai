import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/user-identity';

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const mission = await db.mission.findUnique({ where: { id: params.id } });
    if (!mission) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    // Claim and payout share one transaction. If balance or ledger persistence
    // fails, the claim rolls back too and can be retried without losing a reward.
    const newBalance = await db.$transaction(async tx => {
      const claimed = await tx.userMission.updateMany({
        where: { userId: authUser.userId, missionId: params.id, isCompleted: false },
        data: { isCompleted: true, completedAt: new Date() },
      });

      if (claimed.count === 0) {
        try {
          await tx.userMission.create({
            data: { userId: authUser.userId, missionId: params.id, isCompleted: true, completedAt: new Date() },
          });
        } catch (error) {
          if (isUniqueViolation(error)) return null;
          throw error;
        }
      }

      await tx.user.update({
        where: { id: authUser.userId },
        data: { coins: { increment: mission.rewardCoins } },
      });
      await tx.coinTransaction.create({
        data: {
          userId: authUser.userId,
          amount: mission.rewardCoins,
          type: 'EARNED',
          description: `ภารกิจ: ${mission.title}`,
        },
      });
      const user = await tx.user.findUnique({ where: { id: authUser.userId }, select: { coins: true } });
      return user?.coins ?? null;
    }, { maxWait: 10_000, timeout: 15_000 });

    if (newBalance === null) {
      return NextResponse.json({ error: 'Mission already completed' }, { status: 409 });
    }
    return NextResponse.json({ success: true, coinsEarned: mission.rewardCoins, newBalance });
  } catch (error) {
    logRouteError('POST /api/missions/[id]/complete', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
