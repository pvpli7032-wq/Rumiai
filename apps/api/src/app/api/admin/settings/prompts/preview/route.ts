import {NextResponse} from 'next/server';
import {forbidden, privateHeaders, readJsonBody, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {SETTINGS_BY_KEY, readSettingValue} from '@rumiai/backend/modules/settings/index';
import {readAiModelPlan} from '@rumiai/backend/modules/ai/models/runtime-service';
import {reserveAiCall, finishAiCall, AiQuotaError} from '@rumiai/backend/modules/ai/ai-usage';
import {aiErrorCode, aiUserError, streamOpenAIResponse} from '@rumiai/backend/modules/conversations/chat-stream';
import type {AiStreamMetrics} from '@rumiai/backend/modules/ai/types';
import {settingsErrorResponse} from '../../_response';

export const dynamic = 'force-dynamic';

/**
 * 提示词试生成（V3 §16）：用当前保存的模板真实跑一次模型，把结果给管理员看。
 *
 * 只读当前值，不改草稿 —— 保存仍然走原来的分组保存，试生成成功与否都不影响保存。
 * 这是一次真实的模型调用：记 AiCall（operation=PROMPT_PREVIEW）、成本照常计入，
 * 但不建费用单、不扣币，也不占用户的聊天每日次数。
 */
const MAX_SAMPLE_CHARS = 2000;

/** 试生成用一个中性的执行者身份：模板本身就是完整指令，不需要角色设定。 */
const PREVIEW_PERSONA = {name: '模板试跑', personality: '严格按给定指令执行，只输出指令要求的内容', background: null, scenario: null, roleTemplate: null, isAdult: false};

export async function POST(request: Request) {
  const access = await requireAdmin(request, 'settings.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置保存权限的管理员可以试生成提示词。');
  const body = await readJsonBody(request, {maxBytes: 12_000});
  if (body.response) return body.response;
  try {
    const record = (body.input ?? {}) as Record<string, unknown>;
    const key = record.key;
    if (typeof key !== 'string' || !SETTINGS_BY_KEY[key] || SETTINGS_BY_KEY[key].type !== 'text') {
      return NextResponse.json({error: '请选择要试生成的提示词。', code: 'INVALID_INPUT'}, {status: 400, headers: privateHeaders});
    }
    const sample = typeof record.sample === 'string' ? record.sample.trim() : '';
    if (!sample) return NextResponse.json({error: '请填写示例输入。', code: 'INVALID_INPUT'}, {status: 400, headers: privateHeaders});
    if (sample.length > MAX_SAMPLE_CHARS) {
      return NextResponse.json({error: `示例输入不能超过 ${MAX_SAMPLE_CHARS} 字。`, code: 'INVALID_INPUT'}, {status: 400, headers: privateHeaders});
    }

    const template = (await readSettingValue<string>(key)).trim();
    if (!template) return NextResponse.json({error: '这项提示词还没有内容，先填写并保存后再试生成。', code: 'INVALID_INPUT'}, {status: 400, headers: privateHeaders});

    const plan = await readAiModelPlan(null);
    if (plan !== null && plan.length === 0) {
      return NextResponse.json({error: '当前没有可用的模型路由，请先在「模型与供应商」启用一个模型。', code: 'NO_MODEL'}, {status: 503, headers: privateHeaders});
    }

    let call: Awaited<ReturnType<typeof reserveAiCall>>;
    try {
      call = await reserveAiCall(access.user.userId, '', 'PROMPT_PREVIEW', plan?.map(model => model.key));
    } catch (error) {
      if (error instanceof AiQuotaError) return NextResponse.json({error: error.message, code: 'QUOTA'}, {status: error.status, headers: privateHeaders});
      throw error;
    }
    let metrics: AiStreamMetrics = {};
    try {
      const text = await streamOpenAIResponse({enqueue() {}} as unknown as ReadableStreamDefaultController, PREVIEW_PERSONA, [], sample, null, {
        onMetrics(value) { metrics = value; },
        // 模板当指令进系统提示、示例输入当用户消息，与正式链路里「模板 → 系统提示、内容 → 用户消息」一致。
        context: template,
        ...(plan && plan.length ? {models: plan, providers: plan.map(model => model.provider)} : {}),
      });
      await finishAiCall(call.id, call.startedAt, 'SUCCEEDED', metrics).catch(() => null);
      return NextResponse.json({key, result: text.trim(), model: metrics.model ?? null, tokens: {input: metrics.inputTokens ?? null, output: metrics.outputTokens ?? null}}, {headers: privateHeaders});
    } catch (error) {
      await finishAiCall(call.id, call.startedAt, 'FAILED', metrics, aiErrorCode(error)).catch(() => null);
      if (error instanceof AiQuotaError) {
        return NextResponse.json({error: error.message, code: 'QUOTA'}, {status: error.status, headers: privateHeaders});
      }
      return NextResponse.json({error: aiUserError(error), code: aiErrorCode(error)}, {status: 502, headers: privateHeaders});
    }
  } catch (error) {
    return settingsErrorResponse(error, 'POST /api/admin/settings/prompts/preview');
  }
}
