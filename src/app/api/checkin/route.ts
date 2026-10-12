import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

function getStreakCoins(streakDay: number): number {
  if (streakDay >= 7) return 50;
  const rewards = [0, 10, 15, 20, 25, 30, 40, 50];
  return rewards[Math.min(streakDay, 7)];
}

export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({ where: { id: authUser.userId } });
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastCheckin = user.lastCheckin ? new Date(user.lastCheckin) : null;
    lastCheckin?.setHours(0, 0, 0, 0);

    const checkedInToday = lastCheckin?.getTime() === today.getTime();
    const streakDay = user.streakCount;
    const nextCoins = getStreakCoins(streakDay + 1);

    return NextResponse.json({ checkedInToday, streakDay, nextCoins, coins: user.coins });
  } catch (error) {
    logRouteError('GET /api/checkin', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({ where: { id: authUser.userId } });
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastCheckin = user.lastCheckin ? new Date(user.lastCheckin) : null;
    lastCheckin?.setHours(0, 0, 0, 0);

    if (lastCheckin?.getTime() === today.getTime()) {
      return NextResponse.json({ error: 'Already checked in today', checkedInToday: true }, { status: 409 });
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isConsecutive = lastCheckin?.getTime() === yesterday.getTime();
    const newStreak = isConsecutive ? user.streakCount + 1 : 1;
    const coinsEarned = getStreakCoins(newStreak);

    const totalCoins = await db.$transaction(async tx => {
      // Compare-and-swap on the value we just read: concurrent check-ins carry the
      // same original lastCheckin, so only the first one matches and the rest award
      // nothing. Without this, spamming the endpoint paid out once per request.
      const claimed = await tx.user.updateMany({
        where: { id: authUser.userId, lastCheckin: user.lastCheckin },
        data: { streakCount: newStreak, lastCheckin: new Date(), coins: { increment: coinsEarned } },
      });
      if (claimed.count === 0) return null;

      await tx.checkin.create({
        data: { userId: authUser.userId, coinsEarned, streakDay: newStreak },
      });
      await tx.coinTransaction.create({
        data: { userId: authUser.userId, amount: coinsEarned, type: 'EARNED', description: `เช็คอินวันที่ ${newStreak}` },
      });

      const fresh = await tx.user.findUnique({ where: { id: authUser.userId }, select: { coins: true } });
      return fresh?.coins ?? null;
    },
      {
        // Prisma's 5s default is shorter than SQLite's busy timeout, so under real
        // contention the transaction died before it ever got the write lock.
        maxWait: 10_000,
        timeout: 15_000,
      }
    );

    if (totalCoins === null) {
      return NextResponse.json({ error: 'Already checked in today', checkedInToday: true }, { status: 409 });
    }

    return NextResponse.json({ success: true, coinsEarned, streakDay: newStreak, totalCoins });
  } catch (error) {
    logRouteError('POST /api/checkin', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
