import {db} from '@/lib/db';
import {readSettingValue} from '@/lib/settings/service';
import {CHARGE_OPERATIONS, type ChargeOperation, type ChargePriceSnapshot, type QuoteInput, type QuoteResult} from './types';

/**
 * 每条回复的币价（V3 §20 / §28）。
 *
 * 用户看到的是「每条多少币」，按回复固定计价，模型分档；token 与供应商账单只进
 * 成本统计，不参与这里。价格 = ceil(model_coin_prices.coins_per_reply × 用户倍率 / 1000)，
 * 倍率取 billing.priceMultiplier 的用户特例（没有则公共值，默认 1000）。
 * 故事回合在 story.chargingEnabled 且 story.coinPrice > 0 时用故事价，否则沿用聊天价。
 * 他眼中的你（MIRROR）是「购买次数」：只看 mirror.purchaseEnabled 与 mirror.purchaseCoins，
 * 不受聊天收费开关影响，也不占用聊天的免费回复条数（它自己有每日次数）。
 */

/** 千分比倍率：1000 = 原价，0 = 免费。向上取整，任何非零倍率都不会被抹成 0。 */
export function applyPriceMultiplier(baseCoins: number, multiplier: number): number {
  if (!Number.isFinite(baseCoins) || !Number.isFinite(multiplier)) return 0;
  const base = Math.max(0, baseCoins);
  const ratio = Math.max(0, multiplier);
  if (base === 0 || ratio === 0) return 0;
  return Math.ceil((base * ratio) / 1000);
}



/** 当前生效的模型币价行：effective_at ≤ now 里最新的一条。 */
async function readModelCoinPrice(modelId: string, now: Date): Promise<number | null> {
  const row = await db.modelCoinPrice.findFirst({
    where: {modelId, effectiveAt: {lte: now}},
    orderBy: [{effectiveAt: 'desc'}, {id: 'desc'}],
    select: {coinsPerReply: true},
  });
  return row ? row.coinsPerReply : null;
}

/** 定价用的模型：显式选择的模型 → 全站默认模型 → 第一个启用的模型。没有可用模型时返回 null。 */
async function resolvePricingModel(modelKey: string | null | undefined): Promise<{id: string; key: string} | null> {
  const select = {id: true, key: true} as const;
  if (modelKey) {
    const selected = await db.aiModel.findFirst({where: {key: modelKey}, select});
    if (selected) return selected;
  }
  const fallback = await db.aiModel.findFirst({where: {isActive: true}, orderBy: [{isDefault: 'desc'}, {sortOrder: 'asc'}, {id: 'asc'}], select});
  return fallback;
}

export async function quoteReplyPrice(input: QuoteInput): Promise<QuoteResult> {
  const now = input.now ?? new Date();
  const model = await resolvePricingModel(input.modelKey);
  const [chargingEnabled, storyChargingEnabled, storyCoinPrice, mirrorPurchaseEnabled, mirrorPurchaseCoins, multiplierSetting, timezoneSetting] = await Promise.all([
    readSettingValue<boolean>('billing.chargingEnabled', input.userId),
    readSettingValue<boolean>('story.chargingEnabled', input.userId),
    readSettingValue<number>('story.coinPrice', input.userId),
    readSettingValue<boolean>('mirror.purchaseEnabled', input.userId),
    readSettingValue<number>('mirror.purchaseCoins', input.userId),
    readSettingValue<number>('billing.priceMultiplier', input.userId),
    readSettingValue<string>('billing.dayTimezone', input.userId),
  ]);

  const multiplier = Number.isFinite(multiplierSetting) ? Math.max(0, Math.trunc(multiplierSetting)) : 1000;
  // 购买次数只认自己的开关与币价：没开或没定价就是 NO_PRICE，不回落到模型币价。
  const isMirror = input.operation === 'MIRROR';
  const mirrorPrice = isMirror && mirrorPurchaseEnabled === true && Number.isFinite(mirrorPurchaseCoins) && mirrorPurchaseCoins > 0
    ? Math.trunc(mirrorPurchaseCoins)
    : null;
  const storyPrice = input.operation === 'STORY_TURN' && storyChargingEnabled === true && Number.isFinite(storyCoinPrice) && storyCoinPrice > 0
    ? Math.trunc(storyCoinPrice)
    : null;
  const modelPrice = isMirror || storyPrice !== null ? null : model ? await readModelCoinPrice(model.id, now) : null;
  const baseCoins = mirrorPrice ?? storyPrice ?? (modelPrice !== null ? Math.max(0, modelPrice) : null);

  const snapshotBase: Omit<ChargePriceSnapshot, 'coins' | 'pricing' | 'charged' | 'allowanceSource'> = {
    operation: input.operation,
    modelKey: model?.key ?? null,
    baseCoins: baseCoins ?? 0,
    multiplier,
    priceSource: mirrorPrice !== null ? 'MIRROR_PRICE' : storyPrice !== null ? 'STORY_PRICE' : modelPrice !== null ? 'MODEL_PRICE' : 'NONE',
    day: '',
    timezone: typeof timezoneSetting === 'string' && timezoneSetting.trim() ? timezoneSetting.trim() : 'UTC',
    capturedAt: now.toISOString(),
  };

  let pricing: QuoteResult['pricing'];
  let coins = 0;
  const gateOpen = isMirror ? mirrorPurchaseEnabled === true : chargingEnabled === true;
  if (!gateOpen) pricing = 'FREE_MODE';
  else if (baseCoins === null) pricing = 'NO_PRICE';
  else {
    coins = applyPriceMultiplier(baseCoins, multiplier);
    pricing = coins === 0 ? 'FREE_MULTIPLIER' : 'CHARGED';
  }

  return {
    ...snapshotBase,
    coins,
    pricing,
    charged: pricing === 'CHARGED',
    allowanceSource: pricing === 'CHARGED' ? 'PAID' : 'FREE_MODE',
    userId: input.userId,
    operation: input.operation,
    now: now.toISOString(),
  };
}