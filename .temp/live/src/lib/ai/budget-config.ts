export type DailyCostBudget = { site?: number; user?: number };

/** Operator budgets in their original currencies, not model prices or exchange rates. */
export function parseDailyBudgets(raw: string | undefined): Record<string, DailyCostBudget> | null {
  if (!raw?.trim()) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('预算配置必须为币种对象。');
  const budgets: Record<string, DailyCostBudget> = {};
  for (const [currency, limits] of Object.entries(value)) {
    if (!/^[A-Z]{3}$/.test(currency) || !limits || typeof limits !== 'object' || Array.isArray(limits)) throw Error('预算币种或额度格式错误。');
    const entries = Object.entries(limits);
    if (!entries.length || entries.some(([key, amount]) => !['site', 'user'].includes(key) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)) throw Error('预算额度必须为正数，仅支持 site 和 user。');
    budgets[currency] = limits as DailyCostBudget;
  }
  if (!Object.keys(budgets).length) throw Error('预算配置不能为空对象。');
  return budgets;
}

export function budgetCircuitBreakerMode(raw = process.env.AI_BUDGET_CIRCUIT_BREAKER): 'disabled' | 'enabled' | 'invalid' {
  const value = raw?.trim();
  if (!value || value === 'false') return 'disabled';
  return value === 'true' ? 'enabled' : 'invalid';
}
