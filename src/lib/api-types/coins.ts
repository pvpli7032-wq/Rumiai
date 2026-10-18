/** 金币流水。前端与 `lib/coins/ledger-service` 共用这一份形状。 */

export type CoinLedgerEntry = {
  id: string;
  type: 'PURCHASE' | 'EARNED' | 'SPENT';
  amount: number;
  description: string | null;
  sourceKey: string;
  createdAt: string;
};

export type CoinLedgerPage = {
  balance: number;
  /** 一条充值入账都没有才算首充。 */
  firstPurchase: boolean;
  items: CoinLedgerEntry[];
  nextCursor: string | null;
};
