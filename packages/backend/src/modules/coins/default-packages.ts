import type { PrismaClient } from '@prisma/client';

/** Bootstrap the user-approved catalog; preserve later admin edits and old orders. */
export async function initializeDefaultPackages(client: PrismaClient) {
  return client.$transaction(async tx => {
    const defaults = [
      { id: 'xingban-cny-60', label: '入门', coins: 60, priceCnyCents: 600, sortOrder: 0 },
      { id: 'xingban-cny-100', label: '标准', coins: 100, priceCnyCents: 1000, sortOrder: 1 },
      { id: 'xingban-cny-300', label: '畅聊', coins: 300, priceCnyCents: 3000, sortOrder: 2 },
    ];
    for (const data of defaults) {
      if (await tx.coinPackage.findUnique({ where: { id: data.id } })) continue;
      const created = await tx.coinPackage.create({ data: { ...data, priceThb: 0, bonus: 0 } });
      await tx.coinPackageChange.create({ data: { packageId: created.id, actorId: 'SYSTEM_SEED', afterJson: JSON.stringify(created) } });
    }
    const legacy = await tx.coinPackage.findMany({ where: { id: { in: Array.from({ length: 6 }, (_, i) => `xingban-pack-${i}`) }, priceCnyCents: null, isActive: true } });
    for (const before of legacy) {
      const after = await tx.coinPackage.update({ where: { id: before.id }, data: { isActive: false, version: { increment: 1 } } });
      await tx.coinPackageChange.create({ data: { packageId: before.id, actorId: 'SYSTEM_SEED', beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after) } });
    }
  });
}
