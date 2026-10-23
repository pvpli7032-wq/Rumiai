import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {classifyAiCostGroup} from './cost-accounting';
import type {AiBudgetBlock} from './budget-guard';

/**
 * AI 任务级每日预算（V3 表 9 / §22）。
 *
 * 每个任务单独一个每日预算，单位是成本币，与全站预算同一口径：未填写（null）表示
 * 不额外限制，填 0 也是限制（匿名任务填 0 等于关闭入口）。任务预算触发只暂停该任务，
 * 不触发全站熔断；该任务的消耗仍计入全站预算——全站判断读的是同一张 AiCall 台账，
 * 不按任务过滤，所以这里不需要另记一份。
 *
 * 用量也不另建表：AiCall 已有 task_type 与 anonymous_subject，按它们聚合即可。
 * 匿名部分与总量共用 task_type=mirror，匿名调用另带 anonymous_subject。
 */

export const AI_TASK_TYPES = ['chat', 'story', 'mirror', 'mirrorAnonymous', 'disputeVerdict', 'memorySummary'] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const TASK_LABELS: Record<AiTaskType, string> = {
  chat: '聊天',
  story: '故事',
  mirror: '他眼中的你',
  mirrorAnonymous: '他眼中的你（匿名）',
  disputeVerdict: '评理回应',
  memorySummary: '记忆摘要',
};

/** 设置键（settings/registry.ts 的 budget.task.*）与台账 task_type 的对应，只在这里翻译一次。 */
const TASK_SETTING: Record<AiTaskType, string> = {
  chat: 'budget.task.chat',
  story: 'budget.task.story',
  mirror: 'budget.task.mirror',
  mirrorAnonymous: 'budget.task.mirrorAnonymous',
  disputeVerdict: 'budget.task.disputeVerdict',
  memorySummary: 'budget.task.memorySummary',
};

const LEDGER_TASK: Record<AiTaskType, string> = {
  chat: 'chat',
  story: 'story',
  mirror: 'mirror',
  mirrorAnonymous: 'mirror',
  disputeVerdict: 'dispute_verdict',
  memorySummary: 'memory_summary',
};

/** 写进 AiCall.task_type 的值；匿名与总量同为 mirror，靠 anonymous_subject 区分。 */
export function ledgerTaskType(task: AiTaskType): string {
  return LEDGER_TASK[task];
}

/** 单个任务的预算；null 表示不额外限制。 */
export async function readTaskBudget(task: AiTaskType): Promise<number | null> {
  const value = await readSettingValue<number | null>(TASK_SETTING[task]);
  return typeof value === 'number' ? value : null;
}

async function readTaskBudgets(): Promise<Record<AiTaskType, number | null>> {
  const values = await Promise.all(AI_TASK_TYPES.map(task => readTaskBudget(task)));
  return Object.fromEntries(AI_TASK_TYPES.map((task, index) => [task, values[index]])) as Record<AiTaskType, number | null>;
}

export type TaskUsageRow = {currency: string; knownCost: number; unknownCalls: number};

type Group = {currency: string; attempts: number; _count: {_all: number; estimatedCost: number}; _sum: {estimatedCost: number | null}};
type CurrencyUsage = Map<string, TaskUsageRow>;

/** 与全站预算同一口径：排除模拟与在途调用，未知成本单独计数，不按 0 算。 */
function accumulate(rows: CurrencyUsage, groups: Group[]): CurrencyUsage {
  for (const group of groups) {
    const row = rows.get(group.currency) ?? {currency: group.currency, knownCost: 0, unknownCalls: 0};
    const cost = classifyAiCostGroup(group);
    row.knownCost += cost.knownCost;
    row.unknownCalls += cost.unknownCostCalls;
    rows.set(group.currency, row);
  }
  return rows;
}

const sorted = (rows: CurrencyUsage): TaskUsageRow[] => [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency));

/** 今日 UTC 零点起算，和全站预算、费用页的「今日」一致。 */
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const periodOf = (now: Date): Prisma.AiCallWhereInput => ({startedAt: {gte: dayStart(now), lte: now}, status: {notIn: ['MOCK', 'STARTED']}});

/** 今日各任务已用成本，按币种分开。 */
async function readTaskUsage(tx: Prisma.TransactionClient, now: Date): Promise<Record<AiTaskType, TaskUsageRow[]>> {
  const period = periodOf(now);
  const [groups, anonymousGroups] = await Promise.all([
    tx.aiCall.groupBy({by: ['taskType', 'currency', 'attempts'], where: period, _count: {_all: true, estimatedCost: true}, _sum: {estimatedCost: true}}),
    tx.aiCall.groupBy({by: ['currency', 'attempts'], where: {...period, taskType: LEDGER_TASK.mirrorAnonymous, anonymousSubject: {not: null}}, _count: {_all: true, estimatedCost: true}, _sum: {estimatedCost: true}}),
  ]);
  const byTask = new Map<string, CurrencyUsage>();
  for (const group of groups) {
    const key = (group as Group & {taskType: string | null}).taskType;
    if (!key) continue;
    byTask.set(key, accumulate(byTask.get(key) ?? new Map(), [group]));
  }
  const anonymous = accumulate(new Map(), anonymousGroups);
  return Object.fromEntries(AI_TASK_TYPES.map(task => [
    task,
    sorted(task === 'mirrorAnonymous' ? anonymous : byTask.get(LEDGER_TASK[task]) ?? new Map()),
  ])) as Record<AiTaskType, TaskUsageRow[]>;
}

/** 只看一个任务，给入口处的即时判断用。 */
export async function readTaskUsageOf(tx: Prisma.TransactionClient, now: Date, task: AiTaskType): Promise<TaskUsageRow[]> {
  return (await readTaskUsage(tx, now))[task];
}

/**
 * 达到任务预算只暂停该任务：429 友好提示，其他任务与全站熔断都不受影响。
 * 只看已知成本；未知成本要不要拦住调用，由全站预算那条链判断，这里不重复设卡。
 */
export function taskBudgetBlock(task: AiTaskType, limit: number | null, usage: TaskUsageRow[]): AiBudgetBlock | null {
  if (limit === null) return null;
  const label = TASK_LABELS[task];
  const paused = (currency?: string): AiBudgetBlock => ({
    status: 429, code: 'AI_TASK_BUDGET', scope: 'task', ...(currency ? {currency} : {}),
    message: '今天「' + label + '」的 AI 预算已用完，明天再来。',
  });
  // 填 0 就是今天一次也不放行，不看已有用量。
  if (limit <= 0) return paused(usage[0]?.currency);
  for (const row of usage) if (row.knownCost >= limit) return paused(row.currency);
  return null;
}

export type TaskBudgetRow = {taskType: AiTaskType; label: string; limit: number | null; usage: TaskUsageRow[]};

/** 「价格与成本」页：各任务今日已用与预算；未填写显示未设上限，不写成 0。 */
export async function readTaskBudgetReport(tx: Prisma.TransactionClient, now: Date): Promise<TaskBudgetRow[]> {
  const [budgets, usage] = await Promise.all([readTaskBudgets(), readTaskUsage(tx, now)]);
  return AI_TASK_TYPES.map(task => ({taskType: task, label: TASK_LABELS[task], limit: budgets[task], usage: usage[task]}));
}

export type MirrorAccess = {open: true} | {open: false; message: string};

/**
 * 他眼中的你入口开关（V3 表 19）：匿名预算未填写或填 0 时匿名入口关闭并提示待设置，
 * 今日额度用完给友好提示；登录用户只看总量预算，不受匿名预算影响。
 */
export async function readMirrorAccess(anonymous: boolean): Promise<MirrorAccess> {
  const now = new Date();
  if (anonymous) {
    const anonymousLimit = await readTaskBudget('mirrorAnonymous');
    if (anonymousLimit === null) return {open: false, message: '匿名体验暂未开放（待设置匿名预算），登录后可以继续。'};
    if (anonymousLimit <= 0) return {open: false, message: '匿名体验暂未开放，登录后可以继续。'};
  }
  for (const task of (anonymous ? ['mirrorAnonymous', 'mirror'] : ['mirror']) as AiTaskType[]) {
    const limit = await readTaskBudget(task);
    if (limit === null) continue;
    if (taskBudgetBlock(task, limit, await readTaskUsageOf(db, now, task))) {
      return {open: false, message: '今天的体验名额用完了，明天再来或登录后继续。'};
    }
  }
  return {open: true};
}
