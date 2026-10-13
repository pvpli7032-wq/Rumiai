import type { Prisma } from '@prisma/client';
import { classifyAiCostGroup } from './cost-accounting';

/** Keep currencies separate and unknown upstream costs explicit. */
export async function readAiCostReport(tx: Prisma.TransactionClient, since: Date, until = new Date()) {
  const groups = await tx.aiCall.groupBy({
    by: ['currency', 'status', 'attempts'], where: { startedAt: { gte: since, lte: until } },
    _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
  });
  const currencies = new Map<string, { currency: string; calls: number; knownCostCalls: number; unknownCostCalls: number; estimatedCost: number; failedCalls: number; mockCalls: number }>();
  for (const group of groups) {
    const row = currencies.get(group.currency) ?? { currency: group.currency, calls: 0, knownCostCalls: 0, unknownCostCalls: 0, estimatedCost: 0, failedCalls: 0, mockCalls: 0 };
    row.calls += group._count._all;
    if (group.status === 'MOCK') row.mockCalls += group._count._all;
    else {
      const cost = classifyAiCostGroup(group);
      row.knownCostCalls += cost.knownCostCalls;
      row.unknownCostCalls += cost.unknownCostCalls;
      row.estimatedCost += cost.knownCost;
    }
    if (['FAILED', 'CANCELLED'].includes(group.status)) row.failedCalls += group._count._all;
    currencies.set(group.currency, row);
  }
  return [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(row => {
    const realCalls = row.calls - row.mockCalls;
    return { ...row, realCalls, costPerThousandCalls: realCalls > 0 && row.unknownCostCalls === 0 ? row.estimatedCost / realCalls * 1000 : null };
  });
}
