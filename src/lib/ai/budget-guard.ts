import type { Prisma } from '@prisma/client';
import { budgetCircuitBreakerMode, parseDailyBudgets } from './budget-config';
import { classifyAiCostGroup, readAiPriceConfiguration } from './cost-accounting';

export type AiBudgetBlock = {
  status: 429 | 503;
  code: 'AI_BUDGET_CONFIGURATION' | 'AI_COST_BUDGET' | 'AI_COST_UNKNOWN';
  message: string;
  scope?: 'site' | 'user';
  currency?: string;
};

/** Called inside the admission writer transaction. Already running calls are not interrupted. */
export async function readCostBudgetBlock(tx: Prisma.TransactionClient, userId: string, now: Date, currency: string): Promise<AiBudgetBlock | null> {
  const mode = budgetCircuitBreakerMode();
  if (mode === 'disabled') return null;
  const invalid: AiBudgetBlock = { status: 503, code: 'AI_BUDGET_CONFIGURATION', message: 'AI 预算配置不可用，请联系管理员。' };
  if (mode === 'invalid' || !readAiPriceConfiguration()) return invalid;
  let budgets;
  try { budgets = parseDailyBudgets(process.env.AI_DAILY_COST_BUDGETS); } catch { return invalid; }
  const limits = budgets?.[currency];
  if (!/^[A-Z]{3}$/.test(currency) || !limits) return invalid;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const scope of ['site', 'user'] as const) {
    const limit = limits[scope];
    if (limit === undefined) continue;
    const groups = await tx.aiCall.groupBy({
      by: ['attempts'],
      where: { currency, ...(scope === 'user' ? { userId } : {}), startedAt: { gte: since, lte: now }, status: { notIn: ['MOCK', 'STARTED'] } },
      _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
    });
    let knownCost = 0, unknownCostCalls = 0;
    for (const group of groups) {
      const classified = classifyAiCostGroup(group);
      knownCost += classified.knownCost;
      unknownCostCalls += classified.unknownCostCalls;
    }
    if (unknownCostCalls) return { status: 429, code: 'AI_COST_UNKNOWN', message: 'AI 调用费用待核对，暂时无法继续，请联系管理员。', scope, currency };
    if (knownCost >= limit) return { status: 429, code: 'AI_COST_BUDGET', message: '今日 AI 成本预算已达到上限，请在重置后继续。', scope, currency };
  }
  return null;
}
