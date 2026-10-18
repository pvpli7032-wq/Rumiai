import type { AiStreamMetrics } from './types';

type CostGroup = {
  attempts: number;
  _count: { _all: number; estimatedCost: number };
  _sum: { estimatedCost: number | null };
};

/** Old multi-attempt rows may only price their final attempt; never call that a full cost. */
export function classifyAiCostGroup(group: CostGroup) {
  return group.attempts > 1
    ? { knownCostCalls: 0, unknownCostCalls: group._count._all, knownCost: 0 }
    : { knownCostCalls: group._count.estimatedCost, unknownCostCalls: group._count._all - group._count.estimatedCost, knownCost: group._sum.estimatedCost ?? 0 };
}

export function readAiPriceConfiguration(env = process.env) {
  const model = (env.AI_PRICE_MODEL || env.AI_MODEL || 'gpt-4o-mini').trim();
  const price = (raw: string | undefined) => {
    if (!raw?.trim()) return null;
    const amount = Number(raw);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  };
  const inputPrice = price(env.AI_INPUT_PRICE_PER_MILLION), outputPrice = price(env.AI_OUTPUT_PRICE_PER_MILLION);
  return model && inputPrice !== null && outputPrice !== null ? { model, inputPrice, outputPrice } : null;
}

/** Per-request estimate is complete only when a single attempt has reported its usage. */
export function estimateAiCallCost(status: string, metrics: AiStreamMetrics, env = process.env): number | null {
  if (status === 'MOCK') return 0;
  if ((metrics.attempts ?? 1) > 1) return null;
  const pricing = readAiPriceConfiguration(env);
  const input = metrics.inputTokens, output = metrics.outputTokens;
  if (!pricing || metrics.model !== pricing.model || input === undefined || output === undefined || !Number.isInteger(input) || !Number.isInteger(output) || input < 0 || output < 0) return null;
  const cost = (input * pricing.inputPrice + output * pricing.outputPrice) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}
