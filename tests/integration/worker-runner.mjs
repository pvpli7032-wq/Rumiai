import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
if (process.env.DATABASE_URL) throw new Error('worker runner refuses externally supplied DATABASE_URL');
const dir = mkdtempSync(join(tmpdir(), 'rumiai-worker-'));
const dbPath = join(dir, 'worker.sqlite');
const backupDir = join(dir, 'backups');
let child;
let output = '';
let summary;
try {
  const migrations = spawnSync(process.execPath, ['tests/integration/run-worker-migrations.mjs', dbPath], {cwd: root, encoding: 'utf8'});
  if (migrations.status !== 0) throw new Error(migrations.stderr || migrations.stdout);
  const env = {...process.env, NODE_ENV: 'test', DATABASE_URL: `file:${dbPath.replaceAll('\\', '/')}`, BACKUPS_DIRECTORY: backupDir, UPLOADS_DIRECTORY: join(dir, 'uploads'), STORY_WORKER_DISABLED: '1'};
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/index.ts'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  const deadline = Date.now() + 30_000;
  let taskCount = 0;
  let runningCount = 0;
  let executedDueCount = 0;
  let lastRows = [];
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`worker exited before first round: ${child.exitCode}\n${output}`);
    const db = new DatabaseSync(dbPath);
    taskCount = Number(db.prepare('SELECT COUNT(*) AS count FROM background_tasks').get().count);
    runningCount = Number(db.prepare("SELECT COUNT(*) AS count FROM background_tasks WHERE status = 'RUNNING'").get().count);
    const rows = db.prepare('SELECT kind, status, next_run_at, attempts, last_error, lease_owner, lease_until FROM background_tasks').all();
    lastRows = rows;
    db.close();
    const now = Date.now();
    executedDueCount = rows.filter(row => row.kind !== 'daily-backup' && row.status === 'PENDING' && row.attempts === 0 && row.last_error === null && row.lease_owner === null && row.lease_until === null && Number(row.next_run_at) > now).length;
    if (taskCount >= 7 && executedDueCount >= 6 && runningCount === 0) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  const started = output.includes('"event":"worker_started"');
  const runnerStarted = output.includes('"event":"background_task_runner_started"');
  const firstRound = taskCount >= 7 && executedDueCount >= 6 && runningCount === 0 && child.exitCode === null;
  if (!firstRound) throw new Error(`worker first round timeout: taskCount=${taskCount} runningCount=${runningCount} rows=${JSON.stringify(lastRows)}\n${output}`);

  if (process.platform === 'win32') child.send('shutdown'); else child.kill('SIGTERM');
  const exit = child.exitCode !== null ? {code: child.exitCode, signal: child.signalCode} : await Promise.race([
    new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({code, signal}))),
    new Promise(resolvePromise => setTimeout(() => resolvePromise({code: null, signal: 'TIMEOUT'}), 8_000)),
  ]);
  const gracefulStop = output.includes('"event":"worker_stopping"') && exit.code === 0;
  summary = {platform: process.platform, node: process.version, started, runnerStarted, firstRound, registeredTaskCount: taskCount, executedDueCount, runningCount, dailyBackupDeferred: true, gracefulStop, exit, outputTail: output.slice(-2000), sourceState: 'local working tree; not deployed'};
  console.log(JSON.stringify(summary));
  if (!started || !runnerStarted || !gracefulStop) process.exitCode = 1;
} catch (error) {
  summary = {platform: process.platform, node: process.version, status: 'failed', error: error instanceof Error ? error.message : String(error), outputTail: output.slice(-2000), sourceState: 'local working tree; not deployed'};
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolvePromise => child.once('close', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 2_000)),
    ]);
  }
  mkdirSync(join(root, 'artifacts'), {recursive: true});
  const docPath = join(root, 'artifacts/validation-worker.json');
  let document = {sourceState: 'local working tree; not deployed', runs: {}};
  try { document = JSON.parse(readFileSync(docPath, 'utf8')); } catch {}
  document.runs ??= {};
  document.runs[process.platform === 'win32' ? 'windows' : process.platform] = summary;
  writeFileSync(docPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  rmSync(dir, {recursive: true, force: true});
}
