import { db, pragmasReady } from '@/lib/db';
import { readAiCostReport } from '@/lib/ai/cost-report';
import { readDailyBudgetReport } from '@/lib/ai/budget-report';
import { readPaymentValidationMetrics } from '@/lib/payments/validation-metrics';

export type FinanceReport = Awaited<ReturnType<typeof readFinanceReport>>;

/** Read-only local reconciliation. It does not assert settlement with the provider. */
export async function readFinanceReport(days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('统计天数必须为 1–90 的整数。');
  await pragmasReady;
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 86400000);
  return db.$transaction(async tx => {
    const paid = await tx.paymentOrder.aggregate({ where: { status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED'] }, currency: 'CNY', paidAt: { gte: since } }, _count: { _all: true }, _sum: { amountCnyCents: true } });
    const refunds = await tx.paymentRefund.aggregate({ where: { status: 'SUCCEEDED', completedAt: { gte: since } }, _count: { _all: true }, _sum: { amountCnyCents: true } });
    // These invariant checks cover ALL retained orders, not just the cost window.
    const broken = await tx.$queryRaw<{ orderNo: string; userId: string; status: string; expectedCoins: number; actualCoins: number | null }[]>`
      SELECT p.order_no AS orderNo, p.user_id AS userId, p.status,
             p.coin_amount AS expectedCoins, t.amount AS actualCoins
      FROM payment_orders p LEFT JOIN coin_transactions t ON t.payment_order_id = p.id
      WHERE (p.status IN ('PAID', 'REFUND_PENDING', 'REFUNDED') AND (t.id IS NULL OR t.amount != p.coin_amount OR t.user_id != p.user_id OR t.type != 'PURCHASE'))
         OR (p.status NOT IN ('PAID', 'REFUND_PENDING', 'REFUNDED') AND t.id IS NOT NULL)
      ORDER BY p.created_at ASC LIMIT 101`;
    const refundAnomalies = await tx.$queryRaw<{ orderNo: string; refundNo: string | null; refundStatus: string | null; orderStatus: string; expectedCoins: number | null; debitCoins: number | null; releaseCoins: number | null }[]>`
      SELECT p.order_no AS orderNo, r.refund_no AS refundNo, r.status AS refundStatus, p.status AS orderStatus,
             r.coin_amount AS expectedCoins, d.amount AS debitCoins, l.amount AS releaseCoins
      FROM payment_orders p LEFT JOIN payment_refunds r ON r.payment_order_id = p.id
      LEFT JOIN coin_transactions d ON d.refund_id = r.id
      LEFT JOIN coin_transactions l ON l.refund_release_id = r.id
      WHERE (p.status IN ('REFUND_PENDING', 'REFUNDED') AND r.id IS NULL)
         OR (r.id IS NOT NULL AND (
           r.amount_cny_cents != p.amount_cny_cents OR r.coin_amount != p.coin_amount OR
           d.id IS NULL OR d.user_id != p.user_id OR d.amount != -r.coin_amount OR d.type != 'REFUND' OR
           (r.status IN ('PROCESSING', 'UNKNOWN') AND (p.status != 'REFUND_PENDING' OR l.id IS NOT NULL)) OR
           (r.status = 'SUCCEEDED' AND (p.status != 'REFUNDED' OR l.id IS NOT NULL)) OR
           (r.status = 'FAILED' AND (p.status != 'PAID' OR l.id IS NULL OR l.user_id != p.user_id OR l.amount != r.coin_amount OR l.type != 'REFUND_RELEASE')) OR
           r.status NOT IN ('PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED')
         ))
      ORDER BY p.created_at ASC LIMIT 101`;
    const negativeBalances = await tx.user.findMany({ where: { coins: { lt: 0 } }, select: { id: true, coins: true }, orderBy: { id: 'asc' }, take: 101 });
    const aiCosts = await readAiCostReport(tx, since, generatedAt);
    const aiBudget = await readDailyBudgetReport(tx, generatedAt);
    const validationMetrics = await readPaymentValidationMetrics(tx, since, generatedAt);
    return {
      generatedAt: generatedAt.toISOString(), since: since.toISOString(), days,
      paidOrders: paid._count._all, paidAmountCnyCents: paid._sum.amountCnyCents ?? 0,
      completedRefunds: refunds._count._all, refundedAmountCnyCents: refunds._sum.amountCnyCents ?? 0,
      netAfterRefundsCnyCents: (paid._sum.amountCnyCents ?? 0) - (refunds._sum.amountCnyCents ?? 0),
      orderAnomalies: broken.slice(0, 100), orderAnomaliesTruncated: broken.length > 100,
      refundAnomalies: refundAnomalies.slice(0, 100), refundAnomaliesTruncated: refundAnomalies.length > 100,
      negativeBalances: negativeBalances.slice(0, 100), negativeBalancesTruncated: negativeBalances.length > 100,
      aiCosts,
      aiBudget,
      validationMetrics,
    };
  });
}
