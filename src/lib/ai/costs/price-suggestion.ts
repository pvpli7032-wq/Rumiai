/**
 * 成本换算口径与建议币价（V3 §28）。
 *
 * 平台成本以成本币计价、用户售价以人民币计价，两者不能直接相加：先按负责人填写的
 * 汇率折成人民币，再除以每币单价，才得到「币」。这里只做纯计算，设置读取与套餐查询
 * 留在 coin-prices-admin.ts —— 价格页与后台接口因此共用同一套公式，不会各算一遍。
 *
 * 四项缺一就不出数字：样本条数、汇率、目标毛利、每币单价。缺什么写什么，不编。
 */

export interface ExchangeRateState {
  /** 当前生效的汇率（人民币/成本币）；null 表示还没有可用汇率。 */
  rate: number | null;
  /** 已填写但还没到生效时间的汇率。 */
  pendingRate: number | null;
  /** 待生效汇率的生效时间。 */
  pendingEffectiveAt: string | null;
  /** 当前生效汇率的生效时间；null 表示未设时间（立即生效）。 */
  effectiveAt: string | null;
}

export interface PricingBasis {
  /** 给出建议价所需的最小样本条数，来自设置中心 cost.suggestedPriceMinSample。 */
  minSample: number;
  /** 目标毛利百分比；null 表示未设，不生成建议价。 */
  targetMarginPercent: number | null;
  /** 每币单价（人民币/币），由在售套餐的实发币数折算；null 表示没有可用的套餐价格。 */
  coinUnitPriceCny: number | null;
  /**
   * 全部在售套餐的每币单价区间（V3 §218）。多档套餐价格不同，页面按区间展示；
   * 建议价与毛利仍用 coinUnitPriceCny 这个最优惠单值，不做加权（没有真实消费归因）。
   */
  coinUnitPriceRangeCny: {min: number; max: number} | null;
  /** 单价口径说明，例如「最优惠到手价：标准 ¥10 / 100 币」。 */
  coinUnitPriceNote: string | null;
  exchange: ExchangeRateState;
}

/** 一个模型在所选区间内的成本样本。 */
export interface CostSample {
  currency: string;
  calls: number;
  knownCostCalls: number;
  estimatedCost: number;
}

export type PriceOutcome =
  | {kind: 'suggested'; coins: number; costCny: number; revenueCny: number}
  | {kind: 'missing'; reasons: string[]};

export type MarginOutcome =
  | {kind: 'margin'; percent: number; costCny: number; revenueCny: number}
  | {kind: 'missing'; reasons: string[]};

/** 汇率只按「成本币」定义；成本价本身就是人民币时不再折算，避免重复乘一次汇率。 */
function rateFor(currency: string | null, exchange: ExchangeRateState): number | null {
  if (exchange.rate === null) return null;
  return currency === 'CNY' ? 1 : exchange.rate;
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {hour12: false});
}

interface CostCheck {
  reasons: string[];
  /** 每回复成本（人民币）；null 表示还算不出来。 */
  perReplyCostCny: number | null;
}

/** 把「区间成本」折成「每条回复的人民币成本」，顺带收集缺什么。 */
function checkCost(sample: CostSample | null, basis: PricingBasis): CostCheck {
  const reasons: string[] = [];
  const calls = sample?.calls ?? 0;
  if (calls < basis.minSample) reasons.push(`样本不足 ${calls}/${basis.minSample}`);
  if (sample && sample.knownCostCalls === 0) reasons.push('成本未知');
  const rate = rateFor(sample?.currency ?? null, basis.exchange);
  if (rate === null) {
    // 只登记了未来生效的汇率时，生效前同样没有可用汇率：先说「待填写」，再补上到点时间。
    reasons.push(basis.exchange.pendingEffectiveAt
      ? `待填写汇率（${formatMoment(basis.exchange.pendingEffectiveAt)} 起生效）`
      : '待填写汇率');
  }
  if (reasons.length > 0 || !sample || rate === null) return {reasons, perReplyCostCny: null};
  return {reasons, perReplyCostCny: (sample.estimatedCost / calls) * rate};
}

/**
 * 建议币价：成本(成本币) → ×汇率 = 人民币成本 → ÷(1−目标毛利) = 目标收入 → ÷每币单价 = 币数。
 * 向上取整到 1 币：宁可多收一币，也不让建议价把毛利压到目标以下。
 */
export function suggestPrice(input: {sample: CostSample | null; basis: PricingBasis}): PriceOutcome {
  const check = checkCost(input.sample, input.basis);
  const reasons = [...check.reasons];
  if (input.basis.targetMarginPercent === null) reasons.push('未设目标毛利');
  if (input.basis.coinUnitPriceCny === null) reasons.push('套餐人民币价格待配置');
  const {perReplyCostCny} = check;
  const margin = input.basis.targetMarginPercent;
  const unit = input.basis.coinUnitPriceCny;
  if (perReplyCostCny === null || margin === null || unit === null) return {kind: 'missing', reasons};
  const revenueCny = perReplyCostCny / (1 - margin / 100);
  return {kind: 'suggested', coins: Math.ceil(revenueCny / unit), costCny: perReplyCostCny, revenueCny};
}

/** 贡献毛利：现有收费币价折成人民币，与人民币成本比较；汇率没配时调用方不该渲染这一栏。 */
export function contributionMargin(input: {sample: CostSample | null; coinPriceCoins: number | null; basis: PricingBasis}): MarginOutcome {
  const check = checkCost(input.sample, input.basis);
  const reasons = [...check.reasons];
  if (input.coinPriceCoins === null) reasons.push('待配置收费币价');
  if (input.basis.coinUnitPriceCny === null) reasons.push('套餐人民币价格待配置');
  const {perReplyCostCny} = check;
  const coins = input.coinPriceCoins;
  const unit = input.basis.coinUnitPriceCny;
  if (perReplyCostCny === null || coins === null || unit === null) return {kind: 'missing', reasons};
  const revenueCny = coins * unit;
  if (revenueCny <= 0) return {kind: 'missing', reasons: ['收费币价为 0，没有收入']};
  return {kind: 'margin', percent: ((revenueCny - perReplyCostCny) / revenueCny) * 100, costCny: perReplyCostCny, revenueCny};
}
