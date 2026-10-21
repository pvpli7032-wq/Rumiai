/**
 * 统一后台任务的类型（V3 第 24 章）。
 *
 * 任务落在 background_tasks 一张表：kind + subjectId 唯一，带持久租约与有限重试。
 * 单次任务（摘要、结案）由业务侧登记 subjectId；巡检任务（过期、对账、备份清理）
 * 用 SWEEP_SUBJECT 作 subjectId，由轮询按间隔重新排期。
 */

export const SWEEP_SUBJECT = 'sweep';

/** 单次任务：subjectId 是一条具体记录。 */
export const SUBJECT_TASK_KINDS = ['memory-summary', 'dispute-close'] as const;

/**
 * 巡检任务：没有具体记录，按轮询间隔重复执行。
 * daily-backup 是例外：它自己排下一次（+24h），用 nextRunAt 实现「每天一次」。
 */
export const SWEEP_TASK_KINDS = ['story-state', 'dispute-sweep', 'mirror-expire', 'charge-recovery', 'backup-cleanup', 'daily-backup', 'event-cleanup'] as const;

/**
 * 重试用尽后必须置 FAILED 的巡检 kind。
 *
 * 普通巡检失败留在 PENDING 等下一轮（它本来就要反复扫）；但每天只跑一次的备份不能这样：
 * 失败后每 15 秒重跑一次只会反复打备份、而且永远看不到「坏了」。置 FAILED 后在后台
 * 任务页可见，人工「执行一次」会把它重新排期并重跑。
 */
export const FAIL_ON_EXHAUSTED_KINDS = ['daily-backup'] as const;

type SubjectTaskKind = (typeof SUBJECT_TASK_KINDS)[number];
type SweepTaskKind = (typeof SWEEP_TASK_KINDS)[number];
export type TaskKind = SubjectTaskKind | SweepTaskKind;

export interface TaskOutcome {
  /** 一句话结果，写进后台任务列表。 */
  outcome: string;
  detail?: string;
  /** 巡检任务的下次运行时间；不给就按 tasks.intervalMs 排下一轮。 */
  nextRunAt?: Date;
}

export type TaskHandler = (subjectId: string) => Promise<TaskOutcome>;

export interface TaskRunReport {
  claimed: number;
  done: number;
  failed: number;
  retried: number;
  results: Array<{kind: string; subjectId: string; outcome: string; error?: string}>;
}

export interface TaskRowView {
  id: string;
  kind: string;
  subjectId: string;
  status: string;
  attempts: number;
  nextRunAt: string;
  lastError: string | null;
  updatedAt: string;
}
