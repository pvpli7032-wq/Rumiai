import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

const DEFAULT_GIFT_AMOUNT = 10;
const MAX_GIFT_AMOUNT = 1_000_000;

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const rawAmount = body.giftAmount ?? body.amount ?? DEFAULT_GIFT_AMOUNT;
    const giftType = typeof (body.giftType ?? body.type) === 'string' ? (body.giftType ?? body.type) : 'rose';

    // A negative amount used to pass the balance check below and then turn the
    // `decrement` into a credit, minting coins for free. Anything that is not a
    // positive whole number in range is rejected outright.
    if (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > MAX_GIFT_AMOUNT) {
      return NextResponse.json(
        { error: `Gift amount must be a whole number between 1 and ${MAX_GIFT_AMOUNT}` },
        { status: 400 }
      );
    }
    const amount = rawAmount;

    const character = await db.character.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isPublic: true, reviewStatus: true, creatorId: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const gift = await db.$transaction(async tx => {
      // Deduct conditionally so two concurrent gifts cannot both pass a balance
      // check and overdraw the account.
      const debited = await tx.user.updateMany({
        where: { id: authUser.userId, coins: { gte: amount } },
        data: { coins: { decrement: amount } },
      });
      if (debited.count === 0) return null;

      await tx.coinTransaction.create({
        data: {
          userId: authUser.userId,
          amount: -amount,
          type: 'SPENT',
          description: `ส่งของขวัญ ${giftType} ให้ ${character.name}`,
        },
      });
      await tx.character.update({
        where: { id: character.id },
        data: { giftCount: { increment: 1 } },
      });
      return tx.gift.create({
        data: { senderId: authUser.userId, characterId: character.id, amount, giftType },
      });
    },
      {
        // Prisma's 5s default is shorter than SQLite's busy timeout, so under real
        // contention the transaction died before it ever got the write lock.
        maxWait: 10_000,
        timeout: 15_000,
      }
    );

    if (!gift) {
      return NextResponse.json({ error: 'Insufficient coins balance' }, { status: 400 });
    }

    return NextResponse.json({ success: true, gift }, { status: 201 });
  } catch (error) {
    logRouteError('POST /api/characters/[id]/gift', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
