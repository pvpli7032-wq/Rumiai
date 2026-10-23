import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettings} from '@rumiai/backend/modules/settings/service';
import type {SettingValue} from '@rumiai/contracts/settings/types';
import type {ChargePriceSnapshot, QuoteInput, QuoteResult} from '@rumiai/contracts/billing/types';
import {readMembershipBenefit} from '@rumiai/backend/modules/memberships/service';

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

/** 参与定价的设置键；快照里的 settingsVersion 就是这些键当时的版本号。 */
const PRICING_KEYS = [
  'billing.chargingEnabled',
  'story.chargingEnabled',
  'story.coinPrice',
  'mirror.purchaseEnabled',
  'mirror.purchaseCoins',
  'billing.priceMultiplier',
  'billing.dayTimezone',
] as const;

type PricingKey = (typeof PRICING_KEYS)[number];

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
  // 一次读齐定价用到的设置，同时拿到各自版本号写进快照（V3 表 4「配置版本」）。
  const settings = await readSettings([...PRICING_KEYS], input.userId);
  const setting = Object.fromEntries(settings.map(item => [item.key, item])) as Record<PricingKey, SettingValue>;
  const chargingEnabled = setting['billing.chargingEnabled'].value as boolean;
  const storyChargingEnabled = setting['story.chargingEnabled'].value as boolean;
  const storyCoinPrice = setting['story.coinPrice'].value as number;
  const mirrorPurchaseEnabled = setting['mirror.purchaseEnabled'].value as boolean;
  const mirrorPurchaseCoins = setting['mirror.purchaseCoins'].value as number;
  const multiplierSetting = setting['billing.priceMultiplier'].value as number;
  const membershipMultiplier = input.operation === 'CHAT_SEND' || input.operation === 'CHAT_REGENERATE'
    ? await readMembershipBenefit(input.userId, 'CHAT_PRICE_MULTIPLIER')
    : null;
  const timezoneSetting = setting['billing.dayTimezone'].value as string;

  // Membership contract stores 0.01..10 as a real factor (0.8 = 80%).
  // Charge snapshots use the existing integer-per-thousand representation.
  const membershipRatio = membershipMultiplier ? Math.round(membershipMultiplier.value * 1000) : null;
  const configuredMultiplier = Number.isFinite(multiplierSetting) ? Math.max(0, Math.trunc(multiplierSetting)) : 1000;
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
  const configuredCoins = baseCoins === null ? 0 : applyPriceMultiplier(baseCoins, configuredMultiplier);
  const membershipCoins = baseCoins === null || membershipRatio === null ? configuredCoins : applyPriceMultiplier(baseCoins, Math.max(0, membershipRatio));
  const membershipApplied = membershipRatio !== null && membershipCoins < configuredCoins;
  const multiplier = membershipApplied ? Math.max(0, membershipRatio) : configuredMultiplier;

  const snapshotBase: Omit<ChargePriceSnapshot, 'coins' | 'pricing' | 'charged' | 'allowanceSource'> = {
    operation: input.operation,
    modelKey: model?.key ?? null,
    baseCoins: baseCoins ?? 0,
    multiplier,
    membershipMultiplierOrderNo: membershipApplied ? membershipMultiplier?.orderNo ?? null : null,
    priceSource: mirrorPrice !== null ? 'MIRROR_PRICE' : storyPrice !== null ? 'STORY_PRICE' : modelPrice !== null ? 'MODEL_PRICE' : 'NONE',
    day: '',
    timezone: typeof timezoneSetting === 'string' && timezoneSetting.trim() ? timezoneSetting.trim() : 'UTC',
    capturedAt: now.toISOString(),
    settingsVersion: Object.fromEntries(settings.map(item => [item.key, item.version])),
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
