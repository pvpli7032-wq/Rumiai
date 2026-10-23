import {db} from '@rumiai/backend/infrastructure/database/client';
import type {CoinLedgerEntry, CoinLedgerPage} from '@rumiai/contracts/api-types/coins';

export type {CoinLedgerEntry, CoinLedgerPage};

/**
 * 金币流水与余额。纯读：余额取 user.coins，流水取 coin_transactions，
 * 首充判定看有没有 PURCHASE 类型的入账行——那是支付回调唯一会写的类型。
 */

const TYPES = new Set(['PURCHASE', 'EARNED', 'SPENT']);

function normalizeType(value: string): CoinLedgerEntry['type'] {
  return (TYPES.has(value) ? value : 'EARNED') as CoinLedgerEntry['type'];
}

export async function readCoinLedger(userId: string, options: {cursor?: string | null; take?: number} = {}): Promise<CoinLedgerPage> {
  const take = Math.min(Math.max(options.take ?? 20, 1), 50);
  const cursor = options.cursor && /^[A-Za-z0-9_-]{1,64}$/.test(options.cursor) ? options.cursor : null;

  const [user, purchaseCount, rows] = await Promise.all([
    db.user.findUnique({where: {id: userId}, select: {coins: true}}),
    db.coinTransaction.count({where: {userId, type: 'PURCHASE'}}),
    db.coinTransaction.findMany({
      where: {userId},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: take + 1,
      ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
      select: {id: true, type: true, amount: true, description: true, sourceKey: true, createdAt: true},
    }),
  ]);

  const page = rows.slice(0, take);
  return {
    balance: user?.coins ?? 0,
    firstPurchase: purchaseCount === 0,
    items: page.map(row => ({
      id: row.id,
      type: normalizeType(row.type),
      amount: row.amount,
      description: row.description,
      sourceKey: row.sourceKey,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > take ? page[page.length - 1]?.id ?? null : null,
  };
}
