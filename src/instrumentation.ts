/**
 * Process startup wiring (runs once per server process).
 *
 * The story state-extraction worker is started here so committed turns get their
 * state processed without hanging a request on it. Tasks live in the database
 * with a persisted lease (StoryTurn.leaseOwner/leaseExpiresAt), so pausing and
 * restarting the process loses nothing — the first scan re-claims whatever
 * expired while the worker was down.
 *
 * 运维开关：STORY_WORKER_DISABLED=1 跳过启动，供 worker 暂停/恢复演练与
 * 「状态提取问题先停 worker 再处理」的降级口径使用；默认开启（单实例部署）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.STORY_WORKER_DISABLED?.trim() === '1') return;
  const {startStateWorker} = await import('./lib/stories/lifecycle/state-worker');
  startStateWorker();
}
