import type { Prisma } from '@prisma/client';
import type { DailyCostBudget } from './budget-config';
import { readAiDailyBudgetConfiguration } from './costs/budget-config-service';
import { classifyAiCostGroup } from './cost-accounting';
import {readAiModelPriceCoverage} from './costs/model-price-service';
export { parseDailyBudgets } from './budget-config';

type Budget = DailyCostBudget;
type Usage = { userId: string; currency: string; knownCost: number; unknownCalls: number };

export function evaluateDailyBudgets(budgets: Record<string, Budget>, usage: Usage[]) {
  const alerts: { scope: 'site' | 'user'; currency: string; userId: string | null; knownCost: number; budget: number }[] = [];
  const totals = new Map<string, number>();
  for (const row of usage) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.knownCost);
    const budget = budgets[row.currency]?.user;
    if (budget !== undefined && row.knownCost >= budget) alerts.push({ scope: 'user', currency: row.currency, userId: row.userId, knownCost: row.knownCost, budget });
  }
  for (const [currency, limits] of Object.entries(budgets)) {
    const knownCost = totals.get(currency) ?? 0;
    if (limits.site !== undefined && knownCost >= limits.site) alerts.push({ scope: 'site', currency, userId: null, knownCost, budget: limits.site });
  }
  return {
    alerts: alerts.slice(0, 100), alertsTruncated: alerts.length > 100,
    unknownCostCalls: usage.reduce((sum, row) => sum + row.unknownCalls, 0),
    unbudgetedCurrencies: [...totals.keys()].filter(currency => !budgets[currency]).sort(),
  };
}

export async function readDailyBudgetReport(tx: Prisma.TransactionClient, now: Date) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const configuration=await readAiDailyBudgetConfiguration(tx);
  const coverage=await readAiModelPriceCoverage(tx,now);
  const period = { since: since.toISOString(), timezone: 'UTC' as const, circuitBreaker: configuration.circuitBreaker, pricingConfigured: coverage.configured&&coverage.complete, pricingUnpricedModels:coverage.unpricedModels, source:configuration.source };
  if (configuration.status==='invalid') return { ...period, status: 'invalid' as const };
  if (!configuration.budgets) return { ...period, status: 'disabled' as const };
  const budgets=configuration.budgets;
  const groups = await tx.aiCall.groupBy({
    by: ['userId', 'currency', 'attempts'],
    where: { startedAt: { gte: since, lte: now }, status: { not: 'MOCK' } },
    _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
  });
  const usage = new Map<string, Usage>();
  for (const group of groups) {
    const key = JSON.stringify([group.userId, group.currency]);
    const row = usage.get(key) ?? { userId: group.userId, currency: group.currency, knownCost: 0, unknownCalls: 0 };
    const cost = classifyAiCostGroup(group);
    row.knownCost += cost.knownCost;
    row.unknownCalls += cost.unknownCostCalls;
    usage.set(key, row);
  }
  return { ...period, status: 'enabled' as const, budgets, ...evaluateDailyBudgets(budgets, [...usage.values()]) };
}
