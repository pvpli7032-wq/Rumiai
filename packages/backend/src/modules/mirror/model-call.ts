import {readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import type {RuntimeAiModel} from '@rumiai/backend/modules/ai/models/runtime-service';
import {readActiveAiProviders} from '@rumiai/backend/modules/ai/providers/management-service';
import {AiStreamError, modelChain, openUpstream, type RuntimeProvider} from '@rumiai/backend/modules/conversations/chat-stream';
import {collectStreamText} from '@rumiai/backend/modules/ai/stream-collect';
import type {AiStreamMetrics} from '@rumiai/backend/modules/ai/types';

/**
 * Mirror 的模型调用适配：复用 runtime-service 的模型计划与聊天同一条候选链，
 * 只是不开流给客户端、先拿完整文本再校验。不新写任何供应商请求。
 */

export class MirrorModelError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'MirrorModelError';
  }
}

type ModelPlan = {providers: RuntimeProvider[]; models: RuntimeAiModel[] | null};

/** 与聊天共用模型计划：数据库计划优先，否则走环境变量路由。 */
async function readMirrorModelPlan(characterId: string): Promise<ModelPlan> {
  const plan = await readTaskModelPlan('mirror', {characterId});
  if (plan?.length === 0) throw new MirrorModelError('当前角色暂无可用模型，请更换角色后再试。', 'MIRROR_NO_MODEL');
  const configured = plan === null ? await readActiveAiProviders() : [];
  const environment = process.env.OPENAI_API_KEY?.trim()
    ? [{id: 'environment', name: '环境配置', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY}]
    : [];
  const providers: RuntimeProvider[] = configured.length ? [...configured, ...environment] : environment;
  if (!providers.length) throw new MirrorModelError('AI 服务未配置，暂时无法生成。', 'MIRROR_AI_UNAVAILABLE');
  return {providers, models: plan && plan.length ? plan : null};
}

export type MirrorModelCaller = (prompt: string) => Promise<{text: string; metrics: AiStreamMetrics}>;

/** 按候选链逐个尝试；整段文本拿全后返回，失败时抛出最后一个错误。 */
async function completeWithModel(plan: ModelPlan, prompt: string, metrics: AiStreamMetrics): Promise<string> {
  const candidates = plan.models?.length
    ? plan.models.map(model => ({model: model.modelCode, provider: model.provider, config: model as RuntimeAiModel | undefined}))
    : modelChain(null).flatMap(model => plan.providers.map(provider => ({model, provider, config: undefined})));
  let lastError: unknown = new AiStreamError('UPSTREAM_ERROR');
  for (const candidate of candidates) {
    metrics.model = candidate.model;
    metrics.modelKey = candidate.config?.key;
    metrics.attempts = (metrics.attempts ?? 0) + 1;
    try {
      const response = await openUpstream(candidate.model, prompt, [], '', undefined, candidate.provider, candidate.config);
      const text = await collectStreamText(response, metrics);
      if (!text.trim()) throw new AiStreamError('EMPTY_RESPONSE');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** 给生成流程用的调用器：绑定角色与本次计量对象。 */
export async function createMirrorModelCaller(characterId: string, metrics: AiStreamMetrics): Promise<MirrorModelCaller> {
  const plan = await readMirrorModelPlan(characterId);
  return async prompt => ({text: await completeWithModel(plan, prompt, metrics), metrics});
}
