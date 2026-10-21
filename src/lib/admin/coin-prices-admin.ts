import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {readHistory, readSettingValue} from '@/lib/settings';
import {listActiveCoinPackages} from '@/lib/coins/package-service';
import type {ExchangeRateState, PricingBasis} from '@/lib/ai/costs/price-suggestion';
import {AdminOpsError, idParam} from './ops-error';

/**
 * 模型收费币价（ModelCoinPrice）历史与新增版本。
 *
 * 币价是「按生效时间追加版本」的：新增只插入新行，旧行永远保留，
 * 已经预扣的费用单还带着当时的 price_snapshot_json，改价不影响已开始的请求。
 */

export interface AdminCoinPriceItem {
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

export interface AdminCoinPriceView {
  models: Array<{id: string; key: string; displayName: string}>;
  items: AdminCoinPriceItem[];
  /** 毛利口径由设置中心决定（billing.targetMarginPercent / marginAlertPercent），价格页直接展示。 */
  targetMarginPercent: number;
  marginAlertPercent: number;
  /** 成本换算与建议价的口径（V3 §28）；四项齐备才有建议币价。 */
  pricing: PricingBasis;
}

function toItem(row: {id: string; modelId: string; coinsPerReply: number; effectiveAt: Date; version: number; createdBy: string; createdAt: Date; model: {key: string; displayName: string}}): AdminCoinPriceItem {
  return {
    id: row.id,
    modelId: row.modelId,
    modelKey: row.model.key,
    modelName: row.model.displayName,
    coinsPerReply: row.coinsPerReply,
    effectiveAt: row.effectiveAt.toISOString(),
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

const rowSelect = {
  id: true, modelId: true, coinsPerReply: true, effectiveAt: true, version: true, createdBy: true, createdAt: true,
  model: {select: {key: true, displayName: true}},
} satisfies Prisma.ModelCoinPriceSelect;

/**
 * 当前生效的汇率。
 *
 * 汇率只有一份值，所以「到点前用旧值」只能从设置历史里取：最新一条 cost.exchangeRate
 * 修订记录的 oldValue 就是这次改动之前的汇率。读取时比一次时间即可，不需要定时任务。
 */
async function readExchangeRate(rate: number | null, effectiveAt: string | null): Promise<ExchangeRateState> {
  const empty: ExchangeRateState = {rate: null, pendingRate: null, pendingEffectiveAt: null, effectiveAt: null};
  if (rate === null) return empty;
  const at = effectiveAt ? new Date(effectiveAt) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
    return {...empty, rate, effectiveAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null};
  }
  const history = await readHistory({key: 'cost.exchangeRate', take: 5});
  const previous = history.items
    .map(item => (item.oldValue === null ? null : Number(item.oldValue)))
    .find(value => value !== null && Number.isFinite(value) && value > 0);
  return {rate: previous ?? null, pendingRate: rate, pendingEffectiveAt: at.toISOString(), effectiveAt: null};
}

/**
 * 每币单价（人民币/币）。
 *
 * 复用套餐自己的口径：实发币数 = coins + 当期 bonus，价格取 price_cny_cents。
 * 取最优惠的一档做折算 —— 用户买得最便宜的那档决定平台每币真实收入，用它算建议价不会偏低。
 */
async function readCoinUnitPrice(): Promise<{unitPrice: number | null; note: string | null}> {
  const packages = await listActiveCoinPackages();
  let best: {unitPrice: number; note: string} | null = null;
  for (const pkg of packages) {
    if (!pkg.priceCnyCents || pkg.priceCnyCents <= 0) continue;
    const coins = pkg.coins + pkg.bonus;
    if (coins <= 0) continue;
    const unitPrice = pkg.priceCnyCents / 100 / coins;
    if (best && best.unitPrice <= unitPrice) continue;
    best = {unitPrice, note: `最优惠到手价：${pkg.label} ¥${pkg.priceCnyCents / 100} / ${coins} 币`};
  }
  return {unitPrice: best?.unitPrice ?? null, note: best?.note ?? null};
}

export async function readAdminCoinPrices(): Promise<AdminCoinPriceView> {
  await pragmasReady;
  const [models, rows, targetMarginPercent, marginAlertPercent, minSample, exchangeRate, exchangeEffectiveAt, coinUnit] = await Promise.all([
    db.aiModel.findMany({orderBy: [{sortOrder: 'asc'}, {key: 'asc'}], select: {id: true, key: true, displayName: true}}),
    db.modelCoinPrice.findMany({orderBy: [{modelId: 'asc'}, {effectiveAt: 'desc'}, {id: 'desc'}], take: 200, select: rowSelect}),
    readSettingValue<number>('billing.targetMarginPercent'),
    readSettingValue<number>('billing.marginAlertPercent'),
    readSettingValue<number>('cost.suggestedPriceMinSample'),
    readSettingValue<number>('cost.exchangeRate'),
    readSettingValue<string>('cost.exchangeRateEffectiveAt'),
    readCoinUnitPrice(),
  ]);
  const pricing: PricingBasis = {
    minSample,
    targetMarginPercent,
    coinUnitPriceCny: coinUnit.unitPrice,
    coinUnitPriceNote: coinUnit.note,
    exchange: await readExchangeRate(exchangeRate, exchangeEffectiveAt),
  };
  return {models, items: rows.map(toItem), targetMarginPercent, marginAlertPercent, pricing};
}

export interface AdminCoinPriceInput {
  modelId?: unknown;
  coinsPerReply?: unknown;
  effectiveAt?: unknown;
}

/** 新增一个币价版本：旧版本只读保留，同一模型同一生效时间不允许重复。 */
export async function addAdminCoinPrice(input: AdminCoinPriceInput): Promise<AdminCoinPriceItem> {
  await pragmasReady;
  const modelId = typeof input.modelId === 'string' ? idParam(input.modelId) : '';
  if (!modelId) throw new AdminOpsError('请选择要定价的模型。');
  const coins = Number(input.coinsPerReply);
  if (!Number.isSafeInteger(coins) || coins < 0 || coins > 1_000_000) throw new AdminOpsError('收费币价必须是 0–1000000 的整数。');
  let effectiveAt = new Date();
  if (typeof input.effectiveAt === 'string' && input.effectiveAt.trim()) {
    const parsed = new Date(input.effectiveAt);
    if (Number.isNaN(parsed.getTime())) throw new AdminOpsError('生效时间格式不正确。');
    effectiveAt = parsed;
  }
  const model = await db.aiModel.findUnique({where: {id: modelId}, select: {id: true}});
  if (!model) throw new AdminOpsError('这个模型不存在，请刷新后重试。', 404, 'NOT_FOUND');
  const latest = await db.modelCoinPrice.findFirst({where: {modelId}, orderBy: [{version: 'desc'}], select: {version: true}});
  try {
    const saved = await db.modelCoinPrice.create({
      data: {modelId, coinsPerReply: coins, effectiveAt, version: (latest?.version ?? 0) + 1, createdBy: 'admin'},
      select: rowSelect,
    });
    return toItem(saved);
  } catch (error) {
    if ((error as {code?: string}).code === 'P2002') throw new AdminOpsError('这个模型在该生效时间已经有币价版本，请换一个时间。', 409, 'CONFLICT');
    throw error;
  }
}
