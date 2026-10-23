import {loadWorkspaceEnvironment} from '../../../ops/runtime/environment.mjs';

// Always resolve env/configuration from the monorepo root, even when PM2 starts
// this package with apps/worker as its cwd.
loadWorkspaceEnvironment();

const { db, pragmasReady } = await import('@rumiai/backend/infrastructure/database/client');
const { startTaskRunner } = await import('@rumiai/backend/modules/tasks/runner');

await pragmasReady;
const stop = startTaskRunner();
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: 'worker_stopping', signal }));
  await stop();
  await db.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
// Integration-only in-process shutdown trigger. It is available only when the
// worker is started in NODE_ENV=test with an IPC channel; production has no
// remotely callable shutdown path.
if (process.env.NODE_ENV === 'test' && process.send) process.on('message', message => { if (message === 'shutdown') void shutdown('TEST_IPC'); });
console.info(JSON.stringify({ event: 'worker_started', owner: 'background-task-runner', storyState: 'via-task-kind:story-state' }));
