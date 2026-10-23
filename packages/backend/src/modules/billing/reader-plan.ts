import {readAiModelCatalog} from '@rumiai/backend/modules/ai/models/runtime-service';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';
import {quoteReplyPrice} from '@rumiai/backend/modules/billing/price';
import type {ReplyPlan, ReplyPlanLine} from '@rumiai/contracts/billing/reply-plan';
export type {ReplyPlan, ReplyPlanLine} from '@rumiai/contracts/billing/reply-plan';

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
