import { db } from '@/lib/db';

export function effectivePackageBonus(pkg: { bonus: number; bonusStartsAt: Date | null; bonusEndsAt: Date | null }, now = new Date()) {
  if (pkg.bonusStartsAt && now < pkg.bonusStartsAt) return 0;
  if (pkg.bonusEndsAt && now >= pkg.bonusEndsAt) return 0;
  return pkg.bonus;
}

/** The payment domain uses this exported price snapshot, never a client price. */
export async function readPurchasablePackage(id: string) {
  const pkg = await db.coinPackage.findFirst({ where: { id, isActive: true } });
  return pkg ? { ...pkg, bonus: effectivePackageBonus(pkg) } : null;
}

/** Read the active coin catalog for both the shop and API clients. */
export async function listActiveCoinPackages() {
  const packages = await db.coinPackage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, coins: true, priceThb: true, priceCnyCents: true, bonus: true, label: true, bonusStartsAt: true, bonusEndsAt: true },
  });
  const now = new Date();
  return packages.map(({ bonusStartsAt, bonusEndsAt, ...pkg }) => ({ ...pkg, bonus: effectivePackageBonus({ ...pkg, bonusStartsAt, bonusEndsAt }, now) }));
}
