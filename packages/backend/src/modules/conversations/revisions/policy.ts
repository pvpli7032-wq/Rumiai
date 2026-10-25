import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {readTaskBudget} from '@rumiai/backend/modules/ai/task-budget';
import {readTaskModelKey, readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import {quoteReplyPrice} from '@rumiai/backend/modules/billing/price';
import {ChatContextError} from '../context/access';

export async function revisionPolicy(userId: string, characterId: string) {
  const [enabled, pricingPolicy, maxInstructionChars, budget, modelKey] = await Promise.all([
    readSettingValue<boolean>('chat.revisions.enabled'), readSettingValue<string>('chat.revisions.pricingPolicy'),
    readSettingValue<number>('chat.revisions.maxInstructionChars'), readTaskBudget('chatRevision'), readTaskModelKey('chatRevision'),
  ]);
  const plan = modelKey ? await readTaskModelPlan('chatRevision', {characterId}) : null;
  const model = plan?.[0]?.key === modelKey ? plan[0] : null;
  const quote = model ? await quoteReplyPrice({userId, operation: 'CHAT_REGENERATE', modelKey}) : null;
  const reason = !enabled ? '续写与定向改写暂未开放。' : pricingPolicy !== 'REGENERATE' ? '管理员尚未确认生成费用政策。' :
    !budget || budget <= 0 || !model ? '请先配置任务模型及正数预算。' : quote?.pricing === 'NO_PRICE' ? '任务模型尚未配置回复价格。' : null;
  return {available: !reason, reason, maxInstructionChars, model, quote};
}
export async function requireRevisionPolicy(userId: string, characterId: string) {
  const policy = await revisionPolicy(userId, characterId);
  if (!policy.available || !policy.model) throw new ChatContextError(policy.reason || '生成功能不可用。', 503);
  return policy;
}
