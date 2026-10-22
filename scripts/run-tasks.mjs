// 后台任务的外部执行入口（V3 §192）：宝塔计划任务定时调用，跑完一批就退出。
//
// 为什么需要它：进程内的轮询（src/lib/tasks/runner.ts 的 startTaskRunner）只在
// Next 服务活着时有效，服务停了任务就完全不动。计划任务调这个脚本，等于给任务
// 一条不依赖 Web 进程的执行路径，两条路都走同一张 background_tasks 表、同一份
// 处理器表与同一套租约，不存在「第二份任务系统」。
//
// 用法：
//   node --import tsx scripts/run-tasks.mjs            跑一批到期任务
//   node --import tsx scripts/run-tasks.mjs --loop     反复跑直到没有到期任务（适合 cron 兜底）
//   node --import tsx scripts/run-tasks.mjs --kind=memory-summary
//
// 退出码：0 = 全部成功；1 = 有任务失败（含重试用尽置 FAILED）；2 = 脚本自身异常。
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const kindArg = args.find(item => item.startsWith('--kind='));
const kinds = kindArg ? [kindArg.slice('--kind='.length)] : undefined;

const {db, pragmasReady} = await import('../src/lib/db.ts');
const {ensureSweepTasks, runDueTasks} = await import('../src/lib/tasks/runner.ts');

let exitCode = 0;
try {
  await pragmasReady;
  // 巡检任务的行要先补齐，否则新部署的库第一次调用什么都领不到。
  await ensureSweepTasks();
  const rounds = [];
  for (let round = 0; round < (loop ? 50 : 1); round += 1) {
    const report = await runDueTasks({...(kinds ? {kinds} : {})});
    rounds.push(report);
    // 没领到东西就到底了。巡检任务跑完会把自己排到下一轮（nextRunAt 在将来），
    // 所以「领得到」这件事本身会收敛，不会原地空转。
    if (!loop || report.claimed === 0) break;
  }
  const summary = rounds.reduce((total, report) => ({
    rounds: total.rounds + 1,
    claimed: total.claimed + report.claimed,
    done: total.done + report.done,
    failed: total.failed + report.failed,
    retried: total.retried + report.retried,
    results: total.results.concat(report.results),
  }), {rounds: 0, claimed: 0, done: 0, failed: 0, retried: 0, results: []});
  console.log(JSON.stringify(summary));
  // 失败要让计划任务看到：宝塔会把非 0 退出记成一次失败执行，运维据此告警。
  if (summary.failed > 0) exitCode = 1;
} catch (error) {
  console.error('后台任务执行失败：' + (error instanceof Error ? error.message : String(error)));
  exitCode = 2;
} finally {
  await db.$disconnect();
}
process.exitCode = exitCode;
