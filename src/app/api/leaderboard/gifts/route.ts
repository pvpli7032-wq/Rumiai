import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const gifts = await db.gift.groupBy({
      by: ['characterId'],
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });

    const characterIds = gifts.map(g => g.characterId);
    const characters = await db.character.findMany({
      where: { id: { in: characterIds } },
      select: { id: true, name: true, avatarUrl: true },
    });

    const result = gifts.map((g, index) => {
      const char = characters.find(c => c.id === g.characterId);
      return {
        rank: index + 1,
        characterId: g.characterId,
        name: char?.name || 'Unknown',
        avatarUrl: char?.avatarUrl || null,
        giftAmount: g._sum.amount || 0,
        giftCount: g._count.id,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    logRouteError('GET /api/leaderboard/gifts', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { characterId, amount } = body;
    const giftType = typeof body.giftType === 'string' && body.giftType.trim()
      ? body.giftType.trim().slice(0, 40)
      : 'rose';
    if (
      typeof characterId !== 'string' || !characterId ||
      typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000
    ) {
      return NextResponse.json({ error: 'Invalid gift data' }, { status: 400 });
    }

    const character = await db.character.findUnique({
      where: { id: characterId },
      select: { id: true, name: true, isPublic: true, reviewStatus: true, creatorId: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const newBalance = await db.$transaction(async tx => {
      // Balance check and debit are one conditional write, so concurrent requests
      // cannot both spend the same coins or make the cached balance negative.
      const debited = await tx.user.updateMany({
        where: { id: authUser.userId, coins: { gte: amount } },
        data: { coins: { decrement: amount } },
      });
      if (debited.count === 0) return null;

      await tx.coinTransaction.create({
        data: { userId: authUser.userId, amount: -amount, type: 'SPENT', description: `发送礼物给 ${character.name}` },
      });
      await tx.character.update({ where: { id: character.id }, data: { giftCount: { increment: 1 } } });
      await tx.gift.create({ data: { senderId: authUser.userId, characterId, amount, giftType } });
      const user = await tx.user.findUnique({ where: { id: authUser.userId }, select: { coins: true } });
      return user?.coins ?? null;
    }, { maxWait: 10_000, timeout: 15_000 });

    if (newBalance === null) {
      return NextResponse.json({ error: 'Insufficient coins' }, { status: 400 });
    }

    return NextResponse.json({ success: true, newBalance });
  } catch (error) {
    logRouteError('POST /api/leaderboard/gifts', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
