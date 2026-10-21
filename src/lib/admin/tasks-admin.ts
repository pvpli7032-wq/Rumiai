import {db, pragmasReady} from '@/lib/db';
import {readSettingValue} from '@/lib/settings';
import {runKindNow} from '@/lib/tasks/runner';
import {AdminOpsError, idParam} from './ops-error';

/**
 * 后台任务视图与手动执行一次。
 *
 * 分派表只有 src/lib/tasks/handlers.ts 一份：这里既不重写各域逻辑，也不维护第二套
 * kind → 处理器的映射，避免两边漂移。手动执行就是「把这个 kind 的到期行立刻跑一遍」，
 * 与巡检走完全相同的租约、重试与上限。
 */

export const ADMIN_TASK_KINDS = ['story-state', 'memory-summary', 'dispute-close', 'mirror-expire', 'charge-recovery', 'backup-cleanup', 'daily-backup', 'event-cleanup'] as const;
export type AdminTaskKind = typeof ADMIN_TASK_KINDS[number];

interface TaskDefinition {
  kind: AdminTaskKind;
  name: string;
  description: string;
  /** 该任务当前是否会产生新工作所依赖的开关；null 表示没有独立开关，始终运行。 */
  switchKey: string | null;
}

const DEFINITIONS: readonly TaskDefinition[] = [
  {kind: 'story-state', name: '剧情状态抽取', description: '把已保存的故事回合抽成事件与状态检查点', switchKey: null},
  {kind: 'memory-summary', name: '聊天记忆摘要', description: '普通聊天滚动摘要与事实清单', switchKey: 'memory.enabled'},
  {kind: 'dispute-close', name: '评理结案', description: '到期或票数先到的案例生成角色回应', switchKey: 'dispute.enabled'},
  {kind: 'mirror-expire', name: '他眼中的你过期', description: '把超过保留天数的结果标记为过期', switchKey: 'mirror.enabled'},
  {kind: 'charge-recovery', name: '计费冻结核对', description: '核对超时仍处于冻结的费用单', switchKey: 'billing.chargingEnabled'},
  {kind: 'backup-cleanup', name: '备份清理', description: '按保留份数清理旧备份', switchKey: null},
  {kind: 'daily-backup', name: '每日自动备份', description: '每天备份一次数据库，文件名带业务日期', switchKey: null},
  {kind: 'event-cleanup', name: '玩法事件清理', description: '按事件保留天数删除更早的玩法埋点', switchKey: null},
];

export interface AdminTaskItem {
  kind: AdminTaskKind;
  name: string;
  description: string;
  enabled: boolean;
  switchKey: string | null;
  pending: number;
  running: number;
  failed: number;
  done: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSubjectId: string | null;
  nextRunAt: string | null;
  runnable: boolean;
}

function isKind(value: string): value is AdminTaskKind {
  return (ADMIN_TASK_KINDS as readonly string[]).includes(value);
}

export async function listAdminTasks(): Promise<{items: AdminTaskItem[]}> {
  await pragmasReady;
  const items = await Promise.all(DEFINITIONS.map(async definition => {
    const kind = definition.kind;
    const [counts, latest, enabledValue] = await Promise.all([
      db.backgroundTask.groupBy({by: ['status'], where: {kind}, _count: {_all: true}}),
      db.backgroundTask.findFirst({where: {kind}, orderBy: [{updatedAt: 'desc'}], select: {status: true, updatedAt: true, lastError: true, subjectId: true, nextRunAt: true}}),
      definition.switchKey ? readSettingValue(definition.switchKey).catch(() => null) : Promise.resolve(true),
    ]);
    const countOf = (status: string) => counts.find(row => row.status === status)?._count._all ?? 0;
    return {
      kind,
      name: definition.name,
      description: definition.description,
      enabled: definition.switchKey ? enabledValue !== false : true,
      switchKey: definition.switchKey,
      pending: countOf('PENDING'),
      running: countOf('RUNNING'),
      failed: countOf('FAILED'),
      done: countOf('DONE'),
      lastRunAt: latest ? latest.updatedAt.toISOString() : null,
      lastStatus: latest ? latest.status : null,
      lastError: latest?.lastError ?? null,
      lastSubjectId: latest?.subjectId ?? null,
      nextRunAt: latest ? latest.nextRunAt.toISOString() : null,
      // 每个 kind 都有处理器，都能手动执行一次（备份清理也是，按 tasks.backupRetention 清理）。
      runnable: true,
    } satisfies AdminTaskItem;
  }));
  return {items};
}

export interface AdminTaskRunResult {
  kind: AdminTaskKind;
  detail: string;
  affected: number;
  failed: number;
  finishedAt: string;
}

/** 手动执行一次：只处理当前已到期的行，不修改任何开关。 */
export async function runAdminTaskOnce(rawKind: string): Promise<AdminTaskRunResult> {
  await pragmasReady;
  const kind = idParam(rawKind);
  if (!isKind(kind)) throw new AdminOpsError('没有这个后台任务。', 404, 'NOT_FOUND');
  let report;
  try {
    report = await runKindNow(kind);
  } catch (error) {
    throw new AdminOpsError(error instanceof Error ? error.message : '任务执行失败，请稍后重试。', 500, 'INTERNAL');
  }
  const detail = report.results.length
    ? report.results.map(item => item.outcome).join('，')
    : '当前没有到期的任务，未执行。';
  return {kind, detail, affected: report.done, failed: report.failed, finishedAt: new Date().toISOString()};
}
