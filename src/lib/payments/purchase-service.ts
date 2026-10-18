import { db } from '@/lib/db';
import { maySimulatePurchase } from '@/lib/launch-guards';

const LEGACY_PACKAGE_ORDER: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
};

export class SimulatedPurchaseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SimulatedPurchaseError';
  }
}

/** Local-only shop flow. It credits test coins without charging a payment method. */
export async function simulateCoinPurchase(userId: string, packageId: unknown) {
  if (!maySimulatePurchase(process.env)) {
    throw new SimulatedPurchaseError('充值功能暂未开放；该接口仅供本地测试，未接入真实支付。', 503);
  }
  if (typeof packageId !== 'string' || !packageId) {
    throw new SimulatedPurchaseError('packageId is required', 400);
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
  if (!pkg) throw new SimulatedPurchaseError('Invalid package ID', 400);

  const totalCoins = pkg.coins + pkg.bonus;
  const [user] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { coins: { increment: totalCoins } } }),
    db.coinTransaction.create({
      data: {
        userId,
        sourceKey: 'PAYMENT_PURCHASE',
        amount: totalCoins,
        type: 'PURCHASE',
        description: `ซื้อ ${pkg.coins} + ${pkg.bonus} bonus coins`,
      },
    }),
  ]);

  return { success: true, newBalance: user.coins, coinsAdded: totalCoins };
}
