import { db } from '@rumiai/backend/infrastructure/database/client';
import { maySimulatePurchase } from '@rumiai/backend/infrastructure/config/launch-guards';
import { notifyCoinsReceived } from '@rumiai/backend/modules/notifications/write';
import { notifySafely } from '@rumiai/backend/modules/notifications/emit';

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
  const [user, ledger] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { coins: { increment: totalCoins } } }),
    db.coinTransaction.create({
      data: {
        userId,
        sourceKey: 'PAYMENT_PURCHASE',
        amount: totalCoins,
        type: 'PURCHASE',
        description: `购买 ${pkg.coins} + ${pkg.bonus} 赠送金币`,
      },
      select: { id: true },
    }),
  ]);
  // 到账通知：加币与流水已经提交，通知写在事务外，失败不影响这次充值（V3 §26）。
  await notifySafely(() => notifyCoinsReceived({
    userId, transactionId: ledger.id, amount: totalCoins,
    reason: `充值 ${pkg.coins} + 赠送 ${pkg.bonus} 金币已到账`,
  }), 'coin_purchase');

  return { success: true, newBalance: user.coins, coinsAdded: totalCoins };
}
