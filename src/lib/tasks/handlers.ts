import {readdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {readSettingValue} from '@/lib/settings';
import {runMemorySummaryTask} from '@/lib/memory/summary-service';
import {runDisputeCloseTask, scheduleDueDisputes} from '@/lib/disputes/close-service';
import {expireMirrorResults} from '@/lib/mirror/repository';
import {reconcileHeldCharges} from '@/lib/billing/recovery';
import {processPendingStateWork} from '@/lib/stories/lifecycle/state-worker';
import type {TaskHandler, TaskKind} from './types';

/**
 * 各 kind 的具体执行体。
 *
 * 这里只做「一次调用做一件事」：幂等、可重跑，不自己安排下一次。
 * 重试、租约、上限由 runner 统一处理，处理器只抛错表示「还需要再来一次」。
 */

const backupDirectory = () => path.resolve('prisma', 'backups');

/** 备份清理：只按修改时间保留最新 tasks.backupRetention 份，目录与 .db 文件都算一份。 */
async function pruneBackups(): Promise<{outcome: string; detail?: string}> {
  const keep = await readSettingValue<number>('tasks.backupRetention');
  const directory = backupDirectory();
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {outcome: '备份目录还不存在，无需清理'};
    throw error;
  }
  const dated: Array<{name: string; modifiedAt: number}> = [];
  for (const name of entries) {
    const full = path.join(directory, name);
    const info = await stat(full).catch(() => null);
    if (info) dated.push({name, modifiedAt: info.mtimeMs});
  }
  dated.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const stale = dated.slice(Math.max(0, keep));
  for (const item of stale) await rm(path.join(directory, item.name), {recursive: true, force: true});
  return {outcome: stale.length ? `按保留 ${keep} 份清理，删除 ${stale.length} 份旧备份` : `备份共 ${dated.length} 份，未超过保留 ${keep} 份`};
}

const handlers: Record<TaskKind, TaskHandler> = {
  'memory-summary': async conversationId => {
    const result = await runMemorySummaryTask(conversationId);
    return {outcome: result.outcome, detail: result.detail};
  },
  'dispute-close': async caseId => {
    const result = await runDisputeCloseTask(caseId);
    return {outcome: result.outcome, detail: result.source};
  },
  'story-state': async () => {
    const result = await processPendingStateWork();
    return {outcome: `扫描 ${result.claimed} 个回合，成功 ${result.processed}，失败 ${result.failed}`};
  },
  'dispute-sweep': async () => {
    const queued = await scheduleDueDisputes();
    return {outcome: queued ? `新登记 ${queued} 个到期案例` : '没有到期的评理案例'};
  },
  'mirror-expire': async () => {
    const expired = await expireMirrorResults();
    return {outcome: `标记过期 ${expired} 条结果`};
  },
  'charge-recovery': async () => {
    const result = await reconcileHeldCharges();
    return {outcome: `核对 ${result.scanned} 张冻结费用单，结算 ${result.settled}，释放 ${result.released}，保留 ${result.kept}，转待人工核对 ${result.unknown}`};
  },
  'backup-cleanup': pruneBackups,
};

export function handlerFor(kind: string): TaskHandler | null {
  return (handlers as Record<string, TaskHandler>)[kind] ?? null;
}
