import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const missions = await db.mission.findMany({
      include: {
        userMissions: {
          where: { userId: authUser.userId },
          select: { isCompleted: true, completedAt: true },
        },
      },
    });

    const result = missions.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      rewardCoins: m.rewardCoins,
      category: m.category,
      isCompleted: m.userMissions[0]?.isCompleted ?? false,
      completedAt: m.userMissions[0]?.completedAt ?? null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    logRouteError('GET /api/missions', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
