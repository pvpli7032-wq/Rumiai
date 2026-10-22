import {readAiModelCatalog} from '@/lib/ai/models/runtime-service';
import {readSettingValue} from '@/lib/settings/service';
import {quoteReplyPrice} from './price';
import type {QuoteResult} from './types';

export interface ReplyPlanLine {
  /** 模型逻辑键。 */
  modelKey: string;
  /** 界面显示名，取不到时回落成键。 */
  displayName: string;
  /** 每条回复实际要扣的币；收费关闭或未定价时为 0，pricing 说明原因。 */
  coins: number;
  /** 模型每条基础价（model_coin_prices.coins_per_reply）。 */
  baseCoins: number;
  /** 用户收费倍率（千分比）。 */
  multiplier: number;
  pricing: QuoteResult['pricing'];
  priceSource: QuoteResult['priceSource'];
}

export interface ReplyPlan {
  /** 这个角色实际可选的模型；空表示运营把它限制成了没有可用模型，此时不能开始对话。 */
  models: ReplyPlanLine[];
  /** 没选模型时用哪个；与生成侧 readAiModelCatalog 的 default 同一口径。 */
  defaultModelKey: string | null;
  /** 默认模型的定价，与 /api/me/quota 的 coinsPerReply 同源；没有可选模型时为 null。 */
  defaultLine: ReplyPlanLine | null;
  /** 聊天收费总开关；关闭时前台按「当前免费」措辞，不显示 0 币。 */
  chargingEnabled: boolean;
}

/**
 * 一个角色对读者可见的「可用模型与费用」（V3 表 15 角色详情）。
 *
 * 价格一律由 quoteReplyPrice 现算，页面与接口都不自己乘倍率——与聊天页、预扣结算
 * 走同一份实现，改价或关收费后三处同时变。模型清单与生成侧读同一个
 * readAiModelCatalog，保证「详情页敢展示」就是「真的能选到」。
 * 未登录读者没有用户特例，倍率取公共值；登录后以 /api/me/quota 为准。
 */
export async function readReplyPlan(characterId: string): Promise<ReplyPlan> {
  const [catalog, charging] = await Promise.all([
    readAiModelCatalog(characterId),
    readSettingValue<boolean>('billing.chargingEnabled'),
  ]);
  const lines = await Promise.all(catalog.models.map(async key => {
    const quote = await quoteReplyPrice({userId: '', operation: 'CHAT_SEND', modelKey: key});
    return {
      modelKey: key,
      displayName: catalog.labels[key] ?? key,
      coins: quote.coins,
      baseCoins: quote.baseCoins,
      multiplier: quote.multiplier,
      pricing: quote.pricing,
      priceSource: quote.priceSource,
    } satisfies ReplyPlanLine;
  }));
  const defaultModelKey = catalog.default ?? catalog.models[0] ?? null;
  return {
    models: lines,
    defaultModelKey,
    defaultLine: lines.find(line => line.modelKey === defaultModelKey) ?? lines[0] ?? null,
    chargingEnabled: charging === true,
  };
}
