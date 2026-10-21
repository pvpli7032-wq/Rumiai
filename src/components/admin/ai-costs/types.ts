/**
 * 「价格与成本」页面共用的类型、口径与格式化。
 *
 * 收费币价（ModelCoinPrice，单位「币/条」）与供应商成本价（AiModelPrice，
 * 单位「每百万 Token 的币种金额」）来自两个不同接口，字段必须分列，不能合成一个价格。
 */

export interface CoinPriceItem {
  id: string;
  modelId: string;
  modelKey: string;
  modelName: string;
  coinsPerReply: number;
  effectiveAt: string;
  version: number;
  createdBy: string;
  createdAt: string;
}

export interface CoinPriceView {
  models: {id: string; key: string; displayName: string}[];
  items: CoinPriceItem[];
}

export interface CostPrice {
  id: string;
  currency: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  effectiveAt: string;
  source: string;
  createdAt: string;
}

export interface PriceModel {
  id: string;
  key: string;
  displayName: string;
  modelCode: string;
  providerName: string;
  isActive: boolean;
  prices: CostPrice[];
}

export interface CostPriceView {
  generatedAt: string;
  models: PriceModel[];
}

export interface CostRow {
  currency: string;
  calls: number;
  realCalls: number;
  knownCostCalls: number;
  unknownCostCalls: number;
  estimatedCost: number;
  failedCalls: number;
  mockCalls: number;
  costPerThousandCalls: number | null;
}

export interface ModelCostRow {
  modelId: string | null;
  modelKey: string | null;
  displayName: string;
  providerName: string | null;
  providerModelCode: string | null;
  currency: string;
  calls: number;
  knownCostCalls: number;
  unknownCostCalls: number;
  estimatedCost: number;
  failedCalls: number;
}

export interface BudgetRow {
  currency: string;
  siteLimit: number | null;
  userLimit: number | null;
  isActive: boolean;
  version: number;
  updatedAt: string;
}

export interface CostDashboard {
  generatedAt: string;
  since: string;
  days: number;
  costs: CostRow[];
  modelCosts: ModelCostRow[];
  budget: {
    unknownCostCalls: number;
    pricingConfigured: boolean;
    pricingUnpricedModels: string[];
  };
  /** 日预算与熔断策略：编辑入口留在本页高级设置，财务页只做展示。 */
  settings: {
    source: string;
    status: string;
    circuitBreaker: string;
    circuitBreakerVersion: number;
    rows: BudgetRow[];
  };
}

export interface ChargeRow {
  id: string;
  coins: number;
  status: string;
}

export interface ChargePage {
  items: ChargeRow[];
  summary: {held: number; unknown: number; heldCoins: number};
}

/** 一个模型在页面上的合并视图：收费价、成本价、近 7 天用量。 */
export interface ModelPriceRow {
  id: string;
  key: string;
  displayName: string;
  providerName: string;
  modelCode: string;
  isActive: boolean;
  coinPrice: CoinPriceItem | null;
  coinPricePending: CoinPriceItem | null;
  costPrice: CostPrice | null;
  costPricePending: CostPrice | null;
  usage: ModelCostRow[];
}

/** 样本少于这个条数时平均成本显示「样本不足」，不拿两三次调用算平均。 */
export const COST_AVERAGE_MIN_SAMPLE = 5;

export const NOT_CONFIGURED = '待配置';
export const NOT_ENOUGH_SAMPLE = '样本不足';

export function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('zh-CN', {style: 'currency', currency, maximumFractionDigits: 6}).format(amount);
  } catch {
    return `${amount.toFixed(6)} ${currency}`;
  }
}

export function formatCoins(coins: number): string {
  return `${coins.toLocaleString('zh-CN')} 币`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', {hour12: false});
}

/** 抽屉默认生效时间：至少晚于当前时间，且晚于该模型已有成本价的最新版本。 */
export function defaultEffectiveInput(latest: CostPrice | null): string {
  const base = Math.max(Date.now(), latest ? new Date(latest.effectiveAt).getTime() : 0) + 120_000;
  const date = new Date(base);
  date.setSeconds(0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 取「已生效」的版本：生效时间不晚于现在；没生效的单独留给「待生效」提示。 */
export function pickEffective<T extends {effectiveAt: string}>(items: T[], now = Date.now()): {current: T | null; pending: T | null} {
  const sorted = [...items].sort((a, b) => new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime());
  const current = sorted.find(item => new Date(item.effectiveAt).getTime() <= now) ?? null;
  const pending = sorted.find(item => new Date(item.effectiveAt).getTime() > now) ?? null;
  return {current, pending};
}
