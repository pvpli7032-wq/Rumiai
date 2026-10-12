import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { maySimulatePurchase } from '@/lib/launch-guards';

/**
 * Packages live in the CoinPackage table and are addressed by cuid — that is what
 * `GET /api/coins/packages` advertises and what the shop page sends. The positional
 * '1'..'6' ids are kept as a fallback for older clients only.
 */
const LEGACY_PACKAGE_ORDER: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
};

/**
 * This endpoint credits coins without taking payment — it exists so the shop flow
 * can be exercised before a payment provider is wired up. It is forbidden in
 * production even if an environment variable was mistakenly enabled.
 */

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!maySimulatePurchase(process.env)) {
      return NextResponse.json(
        { error: '充值功能暂未开放；该接口仅供本地测试，未接入真实支付。' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const packageId = body.packageId ?? body.package_id;
    if (typeof packageId !== 'string' || !packageId) {
      return NextResponse.json({ error: 'packageId is required' }, { status: 400 });
    }

    let pkg = await db.coinPackage.findFirst({
      where: { id: packageId, isActive: true },
      select: { id: true, coins: true, bonus: true },
    });

    if (!pkg && Object.prototype.hasOwnProperty.call(LEGACY_PACKAGE_ORDER, packageId)) {
      const [legacyMatch] = await db.coinPackage.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        skip: LEGACY_PACKAGE_ORDER[packageId],
        take: 1,
        select: { id: true, coins: true, bonus: true },
      });
      pkg = legacyMatch ?? null;
    }

    if (!pkg) return NextResponse.json({ error: 'Invalid package ID' }, { status: 400 });

    const totalCoins = pkg.coins + pkg.bonus;
    const [user] = await db.$transaction([
      db.user.update({ where: { id: authUser.userId }, data: { coins: { increment: totalCoins } } }),
      db.coinTransaction.create({
        data: {
          userId: authUser.userId,
          amount: totalCoins,
          type: 'PURCHASE',
          description: `ซื้อ ${pkg.coins} + ${pkg.bonus} bonus coins`,
        },
      }),
    ]);

    return NextResponse.json({ success: true, newBalance: user.coins, coinsAdded: totalCoins });
  } catch (error) {
    logRouteError('POST /api/coins/purchase', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
