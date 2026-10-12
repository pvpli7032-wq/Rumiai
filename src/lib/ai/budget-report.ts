import type { Prisma } from '@prisma/client';

type Budget = { site?: number; user?: number };
type Usage = { userId: string; currency: string; knownCost: number; unknownCalls: number };

/** Operator-defined amounts in each currency; no exchange rates or invented prices. */
export function parseDailyBudgets(raw: string | undefined): Record<string, Budget> | null {
  if (!raw?.trim()) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('预算配置必须为币种对象。');
  const budgets: Record<string, Budget> = {};
  for (const [currency, limits] of Object.entries(value)) {
    if (!/^[A-Z]{3}$/.test(currency) || !limits || typeof limits !== 'object' || Array.isArray(limits)) throw Error('预算币种或额度格式错误。');
    const entries = Object.entries(limits);
    if (!entries.length || entries.some(([key, amount]) => !['site', 'user'].includes(key) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)) throw Error('预算额度必须为正数，仅支持 site 和 user。');
    budgets[currency] = limits as Budget;
  }
  if (!Object.keys(budgets).length) throw Error('预算配置不能为空对象。');
  return budgets;
}

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
  const period = { since: since.toISOString(), timezone: 'UTC' as const };
  let budgets: Record<string, Budget> | null;
  try { budgets = parseDailyBudgets(process.env.AI_DAILY_COST_BUDGETS); }
  catch { return { ...period, status: 'invalid' as const }; }
  if (!budgets) return { ...period, status: 'disabled' as const };
  const groups = await tx.aiCall.groupBy({
    by: ['userId', 'currency'],
    where: { startedAt: { gte: since, lte: now }, status: { not: 'MOCK' } },
    _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
  });
  return { ...period, status: 'enabled' as const, budgets, ...evaluateDailyBudgets(budgets, groups.map(row => ({
    userId: row.userId, currency: row.currency, knownCost: row._sum.estimatedCost ?? 0,
    unknownCalls: row._count._all - row._count.estimatedCost,
  }))) };
}
