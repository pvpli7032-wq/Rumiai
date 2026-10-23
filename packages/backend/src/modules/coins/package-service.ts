import { db } from '@rumiai/backend/infrastructure/database/client';

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
    select: { id: true, coins: true, priceThb: true, priceCnyCents: true, bonus: true, benefitsJson: true, label: true, bonusStartsAt: true, bonusEndsAt: true },
  });
  const now = new Date();
  return packages.map(({ bonusStartsAt, bonusEndsAt, benefitsJson, ...pkg }) => {
    const bonus = effectivePackageBonus({ ...pkg, bonusStartsAt, bonusEndsAt }, now);
    let benefits: string[] = [];
    try { const value = JSON.parse(benefitsJson); if (Array.isArray(value)) benefits = value.filter(item => typeof item === 'string'); } catch { /* Invalid legacy data is shown as no claims. */ }
    return { ...pkg, bonus, totalCoins: pkg.coins + bonus, benefits };
  });
}
