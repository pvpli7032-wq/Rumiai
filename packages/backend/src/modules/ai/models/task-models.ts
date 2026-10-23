import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';
import {readAiModelPlan, type RuntimeAiModel} from './runtime-service';

/**
 * 每个 AI 任务用哪个模型（V3 §22 表 18）。
 *
 * 任务是 chat / story / mirror / disputeVerdict / memorySummary 五个，各自一个设置键。
 * 留空时**原样**返回原来的全局模型计划 —— 这是本模块唯一必须逐字守住的约束：
 * 不填就不能改变现有链路用的模型。只有填了才在该任务自己的候选链最前面插上它，
 * 默认模型与兜底模型仍然排在后面，所以单点故障不会让任务没有模型可用。
 *
 * token 上限与重试次数不在这里决定：它们来自 ai_models.maxOutputTokens / maxRetries，
 * 随 RuntimeAiModel 一起带出来，任务级不重复配置一套。
 */
export const AI_TASK_NAMES = ['chat', 'story', 'mirror', 'disputeVerdict', 'memorySummary'] as const;

export type AiTaskName = (typeof AI_TASK_NAMES)[number];

/** 设置键与任务名分开写：键名由 registry 决定，任务名由调用方使用。 */
export const TASK_MODEL_SETTING: Record<AiTaskName, string> = {
  chat: 'ai.taskModel.chat',
  story: 'ai.taskModel.story',
  mirror: 'ai.taskModel.mirror',
  disputeVerdict: 'ai.taskModel.disputeVerdict',
  memorySummary: 'ai.taskModel.memorySummary',
};

export const TASK_LABELS: Record<AiTaskName, string> = {
  chat: '聊天回复',
  story: '故事回合',
  mirror: '他眼中的你',
  disputeVerdict: '评理结案',
  memorySummary: '记忆摘要',
};

/** 读该任务配置的模型 key；未配置返回空串。 */
export async function readTaskModelKey(task: AiTaskName): Promise<string> {
  const value = await readSettingValue<string>(TASK_MODEL_SETTING[task]);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 按任务取模型计划。
 *
 * 没配 → 与 readAiModelPlan(preferred, characterId) 完全一致（同一个函数、同一份入参）。
 * 配了可用模型 → 该模型打头，后面接原来的默认与兜底。
 * 配了不存在 / 已停用 / 被角色模型范围排除的 key → 记一条警告并回落，绝不抛错。
 */
export async function readTaskModelPlan(
  task: AiTaskName,
  options: {preferred?: string | null; characterId?: string} = {},
): Promise<RuntimeAiModel[] | null> {
  const configured = await readTaskModelKey(task);
  if (!configured) return readAiModelPlan(options.preferred, options.characterId);

  const plan = await readAiModelPlan(configured, options.characterId);
  // 三种落空：环境变量路由（null）、没有可用模型（[]）、配的 key 不在可用列表里（首位不是它）。
  if (plan === null || plan.length === 0 || plan[0]?.key !== configured) {
    logWarning('ai_task_model_unavailable', {
      task,
      setting: TASK_MODEL_SETTING[task],
      model: configured,
      reason: plan === null ? 'NO_MANAGED_MODELS' : plan.length === 0 ? 'NO_USABLE_MODEL' : 'UNKNOWN_KEY',
    });
    return readAiModelPlan(options.preferred, options.characterId);
  }
  return plan;
}
