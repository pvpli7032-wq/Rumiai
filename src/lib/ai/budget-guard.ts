import type { Prisma } from '@prisma/client';
import { readAiDailyBudgetConfiguration } from './costs/budget-config-service';
import { classifyAiCostGroup } from './cost-accounting';
import {readAiModelPriceCoverage} from './costs/model-price-service';
import {budgetCircuitBreakerMode} from './budget-config';

export type AiBudgetBlock = {
  status: 429 | 503;
  /** AI_TASK_BUDGET 是任务级预算：只暂停该任务，不触发全站熔断。 */
  code: 'AI_BUDGET_CONFIGURATION' | 'AI_COST_BUDGET' | 'AI_COST_UNKNOWN' | 'AI_TASK_BUDGET';
  message: string;
  scope?: 'site' | 'user' | 'task';
  currency?: string;
};

/** Called inside the admission writer transaction. Already running calls are not interrupted. */
export async function readCostBudgetBlock(tx: Prisma.TransactionClient, userId: string, now: Date, currency: string, modelKeys?:string[]): Promise<AiBudgetBlock | null> {
  const policy=tx.aiCostPolicy?await tx.aiCostPolicy.findUnique({where:{id:'GLOBAL'}}):null;
  const mode=policy?policy.circuitBreakerEnabled?'enabled':'disabled':budgetCircuitBreakerMode();
  if(mode==='disabled')return null;
  const configuration=await readAiDailyBudgetConfiguration(tx);
  const invalid: AiBudgetBlock = { status: 503, code: 'AI_BUDGET_CONFIGURATION', message: 'AI 预算配置不可用，请联系管理员。' };
  const coverage=await readAiModelPriceCoverage(tx,now,modelKeys);
  if (configuration.circuitBreaker === 'invalid' || configuration.status === 'invalid' || !coverage.configured || !coverage.complete) return invalid;
  const currencies=coverage.currencies.length?coverage.currencies:[currency];
  if(currencies.some(code=>!/^[A-Z]{3}$/.test(code)||!configuration.budgets?.[code]))return invalid;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for(const activeCurrency of currencies){
    const limits=configuration.budgets![activeCurrency];
    for (const scope of ['site', 'user'] as const) {
      const limit = limits[scope];
      if (limit === undefined) continue;
      const groups = await tx.aiCall.groupBy({
        by: ['attempts'],
        where: { currency:activeCurrency, ...(scope === 'user' ? { userId } : {}), startedAt: { gte: since, lte: now }, status: { notIn: ['MOCK', 'STARTED'] } },
        _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
      });
      let knownCost = 0, unknownCostCalls = 0;
      for (const group of groups) {
        const classified = classifyAiCostGroup(group);
        knownCost += classified.knownCost;
        unknownCostCalls += classified.unknownCostCalls;
      }
      if (unknownCostCalls) return { status: 429, code: 'AI_COST_UNKNOWN', message: 'AI 调用费用待核对，暂时无法继续，请联系管理员。', scope, currency:activeCurrency };
      if (knownCost >= limit) return { status: 429, code: 'AI_COST_BUDGET', message: '今日 AI 成本预算已达到上限，请在重置后继续。', scope, currency:activeCurrency };
    }
  }
  return null;
}
