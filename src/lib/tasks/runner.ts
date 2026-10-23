import {randomUUID} from 'node:crypto';
import {db} from '@/lib/db';
import {logWarning} from '@/lib/logger';
import {readSettingValue} from '@/lib/settings';
import {handlerFor} from './handlers';
import {FAIL_ON_EXHAUSTED_KINDS, SWEEP_SUBJECT, SWEEP_TASK_KINDS, type TaskRunReport} from './types';
import {AdminOpsError} from '@/lib/admin/ops-error';

/**
 * 统一后台任务入口（V3 第 24 章）。
 *
 * 三条约束：
 * - 租约在数据库里：进程重启不丢任务，过期的 RUNNING 会被重新领取，别人持有的活租约不会被抢。
 * - 有限重试：失败按 attempts 递增退避，超过 tasks.maxAttempts 置 FAILED 并在后台可见，
 *   不无限重跑同一个坏任务。
 * - 巡检任务没有具体记录，用 SWEEP_SUBJECT 占位，执行完按 tasks.intervalMs 重新排期。
 */

const LEASE_MS = 120_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;

function ownerTag(): string {
  return `task-runner-${process.pid}-${randomUUID()}`;
}

/**
 * 巡检任务：没有就建，到点就把 nextRunAt 提前到当下。
 *
 * daily-backup 首次建行排在 +24h：发布流程本身已经做过一次联合备份，部署瞬间再打一份
 * 只是重复占用；从第二天起每天一份，语义也更接近「每天一次」。
 */
export async function ensureSweepTasks(now = new Date()): Promise<number> {
  let created = 0;
  for (const kind of SWEEP_TASK_KINDS) {
    const existing = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind, subjectId: SWEEP_SUBJECT}}, select: {id: true}});
    if (existing) continue;
    const nextRunAt = kind === 'daily-backup' ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
    await db.backgroundTask.create({data: {kind, subjectId: SWEEP_SUBJECT, status: 'PENDING', attempts: 0, nextRunAt}});
    created += 1;
  }
  return created;
}

/** 单次任务登记：同一 kind+subject 只有一行，重复登记只把时间提前。 */
export async function enqueueTask(kind: string, subjectId: string, runAt = new Date()): Promise<void> {
  await db.backgroundTask.upsert({
    where: {kind_subjectId: {kind, subjectId}},
    create: {kind, subjectId, status: 'PENDING', attempts: 0, nextRunAt: runAt},
    update: {status: 'PENDING', nextRunAt: runAt},
  });
}

async function claimDue(owner: string, now: Date, limit: number, kinds?: string[]) {
  const due = await db.backgroundTask.findMany({
    where: {
      OR: [{status: 'PENDING', nextRunAt: {lte: now}}, {status: 'RUNNING', leaseUntil: {lt: now}}],
      nextRunAt: {lte: now},
      ...(kinds?.length ? {kind: {in: kinds}} : {}),
    },
    orderBy: {nextRunAt: 'asc'},
    take: limit,
    select: {id: true, kind: true, subjectId: true, attempts: true},
  });
  const claimed: typeof due = [];
  for (const row of due) {
    const result = await db.backgroundTask.updateMany({
      where: {id: row.id, OR: [{status: 'PENDING'}, {status: 'RUNNING', leaseUntil: {lt: now}}]},
      data: {status: 'RUNNING', leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: {increment: 1}},
    });
    if (result.count === 1) claimed.push(row);
  }
  return claimed;
}

/**
 * 跑一批到期任务。返回本次处理结果，供 /admin/tasks 手动执行与巡检共用。
 * 单个任务失败不影响同批其他任务。
 */
export async function runDueTasks(options: {limit?: number; now?: Date; kinds?: string[]} = {}): Promise<TaskRunReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? (await readSettingValue<number>('tasks.batchSize'));
  const maxAttempts = await readSettingValue<number>('tasks.maxAttempts');
  const intervalMs = await readSettingValue<number>('tasks.intervalMs');
  const owner = ownerTag();
  const claimed = await claimDue(owner, now, limit, options.kinds);
  const report: TaskRunReport = {claimed: claimed.length, done: 0, failed: 0, retried: 0, results: []};
  if (!claimed.length) return report;

  for (const row of claimed) {
    const handler = handlerFor(row.kind);
    const attempt = row.attempts + 1;
    const isSweep = row.subjectId === SWEEP_SUBJECT;
    if (!handler) {
      await db.backgroundTask.updateMany({where: {id: row.id}, data: {status: 'FAILED', leaseOwner: null, leaseUntil: null, lastError: '未注册的任务类型：' + row.kind}});
      report.failed += 1;
      report.results.push({kind: row.kind, subjectId: row.subjectId, outcome: 'UNKNOWN_KIND'});
      continue;
    }
    try {
      const outcome = await handler(row.subjectId);
      // 巡检任务默认按轮询间隔重排；处理器自己给出 nextRunAt 的（每日备份 +24h）以它为准。
      const nextRunAt = isSweep ? outcome.nextRunAt ?? new Date(now.getTime() + intervalMs) : now;
      await db.backgroundTask.updateMany({
        where: {id: row.id},
        data: {status: isSweep ? 'PENDING' : 'DONE', leaseOwner: null, leaseUntil: null, lastError: null, nextRunAt, attempts: isSweep ? 0 : attempt},
      });
      report.done += 1;
      report.results.push({kind: row.kind, subjectId: row.subjectId, outcome: outcome.outcome});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        // 超过上限：普通巡检留在 PENDING 等下一轮（它本来就会重复），单次任务与
        // daily-backup 这类「一天一次」的巡检置 FAILED 等人工处理，失败在后台可见。
        const staysSweep = isSweep && !(FAIL_ON_EXHAUSTED_KINDS as readonly string[]).includes(row.kind);
        await db.backgroundTask.updateMany({
          where: {id: row.id},
          data: {
            status: staysSweep ? 'PENDING' : 'FAILED',
            leaseOwner: null,
            leaseUntil: null,
            lastError: message.slice(0, 500),
            nextRunAt: staysSweep ? new Date(now.getTime() + intervalMs) : now,
            attempts: staysSweep ? 0 : attempt,
          },
        });
        report.failed += 1;
      } else {
        const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
        await db.backgroundTask.updateMany({
          where: {id: row.id},
          data: {status: 'PENDING', leaseOwner: null, leaseUntil: null, lastError: message.slice(0, 500), nextRunAt: new Date(now.getTime() + backoff)},
        });
        report.retried += 1;
      }
      logWarning('background_task_failed', {kind: row.kind, subjectId: row.subjectId, attempts: attempt});
      report.results.push({kind: row.kind, subjectId: row.subjectId, outcome: 'ERROR', error: message.slice(0, 200)});
    }
  }
  return report;
}

/**
 * 按 kind 手动跑一次（后台任务页的「立即执行」）。
 *
 * 巡检任务先补齐占位行再跑，单次任务直接跑已到期的行；
 * 分派表只有 handlers.ts 一份，后台不另写一套 if 分支。
 */
export async function runKindNow(kind: string): Promise<TaskRunReport> {
  if (!handlerFor(kind)) throw new Error('没有这个后台任务。');
  if ((SWEEP_TASK_KINDS as readonly string[]).includes(kind)) {
    const now = new Date();
    const existing = await db.backgroundTask.findUnique({
      where: {kind_subjectId: {kind, subjectId: SWEEP_SUBJECT}},
      select: {id: true, status: true, leaseUntil: true},
    });
    if (!existing) {
      try {
        await db.backgroundTask.create({data: {kind, subjectId: SWEEP_SUBJECT, status: 'PENDING', attempts: 0, nextRunAt: now}});
      } catch (error) {
        // Another runner may have created the sweep row between find and create.
        if ((error as {code?: unknown})?.code === 'P2002') throw new AdminOpsError('该任务刚刚被其他执行器创建，请稍后再试。', 409, 'TASK_RUNNING');
        throw error;
      }
    } else {
      const live = existing.status === 'RUNNING' && existing.leaseUntil !== null && existing.leaseUntil > now;
      if (live) throw new AdminOpsError('该任务正在运行，请稍后再试。', 409, 'TASK_RUNNING');
      const released = await db.backgroundTask.updateMany({
        where: {
          id: existing.id,
          OR: [
            {status: 'PENDING'},
            {status: 'DONE'},
            {status: 'FAILED'},
            {status: 'RUNNING', OR: [{leaseUntil: null}, {leaseUntil: {lt: now}}]},
          ],
        },
        data: {status: 'PENDING', attempts: 0, nextRunAt: now, leaseOwner: null, leaseUntil: null, lastError: null},
      });
      if (released.count !== 1) throw new AdminOpsError('该任务刚刚被其他执行器领取，请稍后再试。', 409, 'TASK_RUNNING');
    }
  }
  return runDueTasks({kinds: [kind]});
}

let timer: NodeJS.Timeout | null = null;

/**
 * 启动轮询。单实例部署（PM2 一个进程），重复调用只保留一个定时器。
 * 每轮都重新读 tasks.intervalMs，改设置不用重启进程。
 */
export function startTaskRunner(): () => void {
  if (timer) return () => {};
  // 启动时打一条日志：运维要能从进程日志确认巡检真的起来了，而不是只看后台页面有没有数据。
  console.info(JSON.stringify({event: 'background_task_runner_started'}));
  const tick = async () => {
    try {
      await ensureSweepTasks();
      await runDueTasks();
    } catch (error) {
      logWarning('background_task_runner_error', {message: error instanceof Error ? error.message : String(error)});
    }
    const interval = await readSettingValue<number>('tasks.intervalMs').catch(() => 15_000);
    timer = setTimeout(tick, interval);
    timer.unref?.();
  };
  void tick();
  return () => { if (timer) { clearTimeout(timer); timer = null; } };
}

