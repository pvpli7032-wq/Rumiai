import {db, pragmasReady} from '@/lib/db';
import {logWarning} from '@/lib/logger';
import {recordProductEvent} from '@/lib/analytics/product-events';
import {readSettingValue} from '@/lib/settings';
import {readTaskModelPlan} from '@/lib/ai/models/task-models';
import {streamOpenAIResponse} from '@/lib/conversations/chat-stream';
import {finishAiCall, reserveAiCall} from '@/lib/ai/ai-usage';
import type {AiStreamMetrics} from '@/lib/ai/types';
import {readCaseRecord, readTallies} from './case-service';
import {awardHotRewards} from './reward-service';
import {notifyActivityResult} from '@/lib/notifications/write';
import {notifySafely} from '@/lib/notifications/emit';
import type {DisputeCaseRecord, DisputeChoice, DisputeExcerptMessage, DisputeTally, DisputeVerdict} from './types';
import {emptyTally, leadingChoice} from './types';

/**
 * 评理结案（V3 第 24 章）。
 *
 * - 到期或票数先到，先到先结；两个触发点都只登记持久任务，不在响应结束后靠裸 Promise。
 * - 任务执行时条件更新抢占一次（OPEN → CLOSING），多进程同时跑也只有一个结案。
 * - 读详情不发模型请求：只有任务进程调用模型，并记 AiCall 成本。
 * - 失败有限重试后写明确的非 AI 兜底说明，不伪装模型判词。
 */

export const DISPUTE_CLOSE_TASK = 'dispute-close';
/** 模型回应失败的真实尝试次数上限：超过就写兜底说明。 */
const MAX_MODEL_ATTEMPTS = 2;
const CHOICE_LABEL: Record<DisputeChoice, string> = {AUTHOR: '我更有理', OTHER: 'TA 更有理', SPLIT: '各打五十大板'};
const FALLBACK_LEAD = '【系统说明 · 非 AI 回应】';

/** 明确的非 AI 兜底文案：第一句就说明不是模型写的，再给票数与结论。 */
export function buildFallbackVerdict(tally: DisputeTally, maxChars: number): string {
  const main = leadingChoice(tally);
  const outcome = main
    ? `本轮共 ${tally.total} 票，多数选择「${CHOICE_LABEL[main]}」（我 ${tally.AUTHOR} / TA ${tally.OTHER} / 各打五十大板 ${tally.SPLIT}）。`
    : tally.total
      ? `本轮共 ${tally.total} 票，三种看法票数相同（我 ${tally.AUTHOR} / TA ${tally.OTHER} / 各打五十大板 ${tally.SPLIT}），没有一方占多数。`
      : '本轮没有收到投票。';
  return `${FALLBACK_LEAD}角色回应没有成功生成，以下是计票结果。${outcome}这条说明不是 AI 判词，不代表角色立场。`.slice(0, Math.max(40, maxChars));
}

export function buildVerdictPrompt(caseRecord: {claim: string; excerpt: DisputeExcerptMessage[]}, tally: DisputeTally, maxChars: number, template?: string) {
  const excerpt = caseRecord.excerpt.map(message => `${message.role === 'USER' ? '发起人' : '角色'}：${message.content.replace(/\s+/g, ' ').trim().slice(0, 160)}`).join('\n');
  return [
    // 提示词模板由设置中心决定（prompt.disputeVerdict），空模板时用内置这一句。
    template?.trim() || '你是这段聊天里的角色。请以角色身份回应这次评理：承认票数反映的看法，说明你在那段对话里的顾虑，语气克制，不拉踩任何一方。',
    `【摘录】\n${excerpt}`,
    `【诉求】${caseRecord.claim}`,
    `【投票】我更有理 ${tally.AUTHOR} 票 / TA 更有理 ${tally.OTHER} 票 / 各打五十大板 ${tally.SPLIT} 票，共 ${tally.total} 票`,
    `要求：不超过 ${maxChars} 个汉字，一段话，不要标题，不要列表，不要替任何真人说话。`,
  ].join('\n');
}

/** 模型偶尔带标题或超长：只保留一段不超过上限的话。 */
export function cleanVerdict(raw: string, maxChars: number) {
  const text = raw.replace(/\s+/g, ' ').trim();
  const clipped = Array.from(text).slice(0, Math.max(20, maxChars)).join('');
  if (!clipped) throw new Error('EMPTY_VERDICT');
  return clipped;
}

type CloseContext = Pick<DisputeCaseRecord, 'id' | 'claim' | 'characterId' | 'authorId' | 'excerpt'> & {tally: DisputeTally; maxChars: number};

/** 一次模型回应；失败直接抛给上层，由上层决定是否还有下一次。 */
async function generateVerdict(input: CloseContext): Promise<string> {
  const plan = await readTaskModelPlan('disputeVerdict', {characterId: input.characterId ?? undefined});
  if (plan !== null && plan.length === 0) throw new Error('NO_MODEL_ROUTE');
  const character = input.characterId
    ? await db.character.findUnique({where: {id: input.characterId}, select: {name: true, personality: true, background: true, scenario: true, roleTemplate: true, isAdult: true}})
    : null;
  const persona = character ?? {name: '评理主持', personality: '中立转述投票结果，不替任何一方下结论', background: null, scenario: null, roleTemplate: null, isAdult: false};
  // 结案回应不是聊天回合：走成本预算与调用台账，不消耗用户的聊天每日次数。
  // 任务类型必须在 reserve 时给出，否则评理回应的每日预算闸门不会生效。
  const call = await reserveAiCall(input.authorId, '', 'DISPUTE_VERDICT', plan?.map(model => model.key), 'disputeVerdict');
  const startedAt = call.startedAt;
  let metrics: AiStreamMetrics = {};
  try {
    const text = await streamOpenAIResponse({enqueue() {}} as unknown as ReadableStreamDefaultController, persona, [], buildVerdictPrompt(input, input.tally, input.maxChars, await readSettingValue<string>('prompt.disputeVerdict')), null, {
      onMetrics(value) { metrics = value; },
      context: '这是评理广场的结案回应，只输出一段中文，不使用销售或助手口吻。',
      ...(plan && plan.length ? {models: plan, providers: plan.map(model => model.provider)} : {}),
    });
    await finishAiCall(call.id, startedAt, 'SUCCEEDED', metrics).catch(() => null);
    return cleanVerdict(text, input.maxChars);
  } catch (error) {
    await finishAiCall(call.id, startedAt, 'FAILED', metrics, 'VERDICT_GENERATION_FAILED').catch(() => null);
    throw error;
  }
}

export interface CloseOptions {
  /** 后台「立即结案」用：不等截止时间也不等票数。 */
  force?: boolean;
  /** 抢先拿到 CLOSING 后、生成回应前回调（用于测试单次生成的保障）。 */
  onClaim?: () => Promise<void> | void;
  /** 替换模型生成（测试注入）。默认走一次真实模型调用。 */
  generate?: (context: CloseContext) => Promise<string>;
}

export interface CloseCaseResult {
  caseId: string;
  status: 'CLOSED' | 'ALREADY_CLOSED' | 'SKIPPED' | 'RETRY';
  source?: 'AI' | 'FALLBACK';
  error?: string;
}

/**
 * 结案一个案例。幂等且并发安全：只有把 OPEN 条件更新成 CLOSING 的一方写结果。
 * 返回 RETRY 表示案例已放回 OPEN、等待下一轮任务。
 */
export async function closeDisputeCase(caseId: string, options: CloseOptions = {}): Promise<CloseCaseResult> {
  await pragmasReady;
  const caseRecord = await readCaseRecord(caseId).catch(() => null);
  if (!caseRecord) return {caseId, status: 'SKIPPED'};
  if (caseRecord.closeStatus === 'CLOSED') return {caseId, status: 'ALREADY_CLOSED'};
  if (caseRecord.closeStatus !== 'OPEN') return {caseId, status: 'SKIPPED'};

  const {rules, excerpt} = caseRecord;
  const tally = await readTallies([caseId]).then(map => map.get(caseId) ?? emptyTally());
  const exited = caseRecord.postStatus !== 'VISIBLE';
  const reached = exited || options.force || Date.parse(caseRecord.deadlineAt) <= Date.now() || tally.total >= rules.closeAtVotes;
  if (!reached) return {caseId, status: 'SKIPPED'};

  // 抢占就是条件更新：从 OPEN 改成 CLOSING 只会有一次成功，失败方直接返回不重复生成。
  const claimed = await db.disputeCase.updateMany({where: {id: caseId, closeStatus: 'OPEN'}, data: {closeStatus: 'CLOSING'}});
  if (claimed.count !== 1) return {caseId, status: 'ALREADY_CLOSED'};
  // 漏斗埋点跟着这次抢占走：只有真正开始结案的那一次记一条。
  await recordProductEvent({event: 'dispute_closed', subjectKey: caseId});

  const maxChars = Math.max(20, Number(rules.verdictMaxChars) || 120);
  const outcome = {main: leadingChoice(tally), tally};
  const context: CloseContext = {id: caseId, claim: caseRecord.claim, characterId: caseRecord.characterId, authorId: caseRecord.authorId, excerpt, tally, maxChars};

  await options.onClaim?.();
  let lastError: string | null = null;
  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
    if (exited) break;
    try {
      const text = options.generate ? await options.generate(context) : await generateVerdict(context);
      const verdict: DisputeVerdict = {status: 'READY', text, outcome, maxChars, closedAt: new Date().toISOString()};
      return await finish(caseId, verdict) ? {caseId, status: 'CLOSED', source: 'AI'} : {caseId, status: 'ALREADY_CLOSED'};
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logWarning('dispute_verdict_failed', {caseId, attempt: attempt + 1, error: lastError});
    }
  }

  const verdict: DisputeVerdict = {
    status: 'FALLBACK',
    text: exited ? `${FALLBACK_LEAD}发起人在结案前撤回了案例，不再公开投票。这条说明不是 AI 判词。` : buildFallbackVerdict(tally, maxChars),
    outcome, maxChars, closedAt: new Date().toISOString(), failureReason: lastError,
  };
  return await finish(caseId, verdict) ? {caseId, status: 'CLOSED', source: 'FALLBACK', ...(lastError ? {error: lastError} : {})} : {caseId, status: 'ALREADY_CLOSED'};
}

/**
 * 只有仍持有 CLOSING 的案例能落结果；落不下去说明已被别处结案或撤回。
 * 热门奖跟着这次落库走：只有真正写成 CLOSED 的那一次才发，重复结案不会重发。
 */
async function finish(caseId: string, verdict: DisputeVerdict) {
  const saved = await db.disputeCase.updateMany({where: {id: caseId, closeStatus: 'CLOSING'}, data: {closeStatus: 'CLOSED', verdictJson: JSON.stringify(verdict), closedAt: new Date()}});
  if (!saved.count) return false;
  // 结案结果通知发起人：只有真正写成 CLOSED 的这一次才发，重复结案不会重复通知（V3 §26）。
  await notifyCaseClosed(caseId, verdict);
  await awardHotRewards(caseId);
  return true;
}

/** 结案通知：事件键用「案例 id + 结案时间」，同一次结案只落一条。 */
async function notifyCaseClosed(caseId: string, verdict: DisputeVerdict) {
  try {
    const record = await readCaseRecord(caseId);
    await notifySafely(() => notifyActivityResult({
      userId: record.authorId,
      activityId: caseId + ':' + (verdict.closedAt ?? ''),
      activityName: '评理案例',
      summary: '你的评理案例已结案：' + verdict.text.slice(0, 60),
      targetType: 'DISPUTE',
      targetId: caseId,
    }), 'dispute_case_closed');
  } catch (error) {
    // 结案已经落库，通知读不到案例也不能反过来让结案失败。
    logWarning('dispute_close_notify_failed', {caseId, error: error instanceof Error ? error.message : String(error)});
  }
}

/** 到期或票数先到就登记/推进一次结案任务；不在这里发模型请求。 */
export async function enqueueCloseIfReached(caseId: string, now = new Date()) {
  const caseRecord = await readCaseRecord(caseId).catch(() => null);
  if (!caseRecord || caseRecord.closeStatus !== 'OPEN') return false;
  const tally = await readTallies([caseId]).then(map => map.get(caseId) ?? emptyTally());
  const due = Date.parse(caseRecord.deadlineAt) <= now.getTime();
  if (!due && tally.total < caseRecord.rules.closeAtVotes && caseRecord.postStatus === 'VISIBLE') return false;
  const runAt = due ? new Date(caseRecord.deadlineAt) : now;
  await db.backgroundTask.upsert({
    where: {kind_subjectId: {kind: DISPUTE_CLOSE_TASK, subjectId: caseId}},
    create: {kind: DISPUTE_CLOSE_TASK, subjectId: caseId, status: 'PENDING', attempts: 0, nextRunAt: runAt},
    update: {status: 'PENDING', nextRunAt: runAt},
  });
  return true;
}

/** 到期任务登记：在所有案例里找已到期的，登记成持久任务。 */
export async function scheduleDueDisputes(now = new Date(), limit = 50) {
  const due = await db.disputeCase.findMany({where: {closeStatus: 'OPEN', deadlineAt: {lte: now}}, orderBy: {deadlineAt: 'asc'}, take: limit, select: {id: true}});
  let queued = 0;
  for (const row of due) if (await enqueueCloseIfReached(row.id, now)) queued += 1;
  return queued;
}

/**
 * 统一任务入口的 dispute-close 处理器（由 tasks 模块注册，这里不 import tasks）。
 * 只有仍处于可结案状态的案例才执行；失败有限重试后写兜底说明并让任务成功结束，
 * 避免同一案例无限重跑。抛错只用于「还需要再来一次」的情形。
 */
export async function runDisputeCloseTask(subjectId: string): Promise<{outcome: string; source?: 'AI' | 'FALLBACK'}> {
  const result = await closeDisputeCase(subjectId);
  if (result.status === 'RETRY') throw new Error(result.error ?? '结案失败，稍后重试。');
  return {outcome: result.status, ...(result.source ? {source: result.source} : {})};
}

export {emptyTally, leadingChoice};
