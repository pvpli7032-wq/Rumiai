/**
 * 进程启动接线（每个 server 进程只跑一次）。
 *
 * 两件事：
 * 1) 故事状态提取 worker——已提交的回合在后台补齐状态，不挂在请求上。任务落在数据库里
 *    带持久租约（StoryTurn.leaseOwner/leaseExpiresAt），进程重启不丢，第一次扫描重新领取
 *    过期租约。STORY_WORKER_DISABLED=1 可单独停它做演练。
 * 2) 统一后台任务入口——摘要、结案、过期清理、对账、备份清理都在这里轮询
 *    （V3 第 24 章）。轮询间隔、批量、重试上限读设置中心，改完不用重启进程。
 */
// 消息编辑/删除的失效逻辑在这里注册（不在路由模块里），保证任何改消息的路径
// 都走同一个同事务失效，与哪个路由先加载无关。
import './lib/stories/lifecycle/invalidation';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const {startTaskRunner} = await import('./lib/tasks/runner');
  startTaskRunner();

  if (process.env.STORY_WORKER_DISABLED?.trim() === '1') {
    console.info(JSON.stringify({event: 'story_state_worker_disabled'}));
    return;
  }
  const {startStateWorker} = await import('./lib/stories/lifecycle/state-worker');
  startStateWorker();
}
