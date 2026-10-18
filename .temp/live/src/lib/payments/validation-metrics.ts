import type { Prisma } from '@prisma/client';

/** Cohort denominators match their numerators; refunds never erase a payment. */
export async function readPaymentValidationMetrics(tx: Prisma.TransactionClient, since: Date, until: Date) {
  const paidOrders: Prisma.PaymentOrderWhereInput = {
    currency: 'CNY', provider: 'EZFP', status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED'] },
    paidAt: { gte: since, lte: until },
  };
  const cohort: Prisma.UserWhereInput = { createdAt: { gte: since, lte: until } };
  const registeredUsers = await tx.user.count({ where: cohort });
  const payingNewUsers = await tx.user.count({ where: { ...cohort, paymentOrders: { some: paidOrders } } });
  const paidOrderCount = await tx.paymentOrder.count({ where: paidOrders });
  const refundedCohortOrders = await tx.paymentOrder.count({ where: {
    ...paidOrders, refund: { is: { status: 'SUCCEEDED', completedAt: { lte: until } } },
  } });
  return {
    registeredUsers, payingNewUsers, paidOrderCount, refundedCohortOrders,
    newUserPaymentRate: registeredUsers ? payingNewUsers / registeredUsers : null,
    paidOrderRefundRate: paidOrderCount ? refundedCohortOrders / paidOrderCount : null,
    grossMarginRate: null,
  };
}
