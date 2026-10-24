import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const dir = mkdtempSync(join(tmpdir(), 'rumiai-tasks-'));
const dbPath = join(dir, 'tasks.sqlite');
const databaseUrl = `file:${dbPath.replaceAll('\\', '/')}`;
const backupDir = join(dir, 'backups');
const uploadDir = join(dir, 'uploads');
mkdirSync(backupDir);
mkdirSync(uploadDir);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  BACKUPS_DIRECTORY: backupDir,
  UPLOADS_DIRECTORY: uploadDir,
  STORY_WORKER_DISABLED: '1',
  EZFP_ENABLED: 'false',
};
// Never let a validation run inherit credentials or endpoints which could make a
// task handler call an external AI/payment service.
for (const key of ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'EZFP_API_BASE_URL', 'EZFP_MERCHANT_ID', 'EZFP_PRIVATE_KEY']) {
  delete env[key];
}

function runMigrations() {
  const result = spawnSync(process.execPath, ['tests/integration/run-worker-migrations.mjs', dbPath], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'migration failed');
}

function runTasks(args = []) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npm, ['run', 'tasks:run', '--', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  });
}

function parseSummary(result) {
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/).reverse();
  const line = lines.find(candidate => candidate.trim().startsWith('{') && candidate.trim().endsWith('}'));
  if (!line) throw new Error(`tasks:run emitted no JSON summary (exit=${result.status}, signal=${result.signal}, error=${result.error?.message ?? 'none'}): ${lines.slice(0, 8).join('\n')}`);
  return JSON.parse(line);
}

function inspectRows() {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT kind, status, next_run_at, attempts, last_error, lease_owner, lease_until FROM background_tasks ORDER BY kind').all();
  db.close();
  const now = Date.now();
  const dueCompleted = rows.filter(row => row.kind !== 'daily-backup' && row.status === 'PENDING' && row.attempts === 0 && row.last_error === null && row.lease_owner === null && row.lease_until === null && Number(row.next_run_at) > now);
  const daily = rows.find(row => row.kind === 'daily-backup');
  return {
    registeredTaskCount: rows.length,
    executedDueCount: dueCompleted.length,
    runningCount: rows.filter(row => row.status === 'RUNNING').length,
    failedCount: rows.filter(row => row.status === 'FAILED' || row.last_error !== null).length,
    dailyBackupDeferred: Boolean(daily && Number(daily.next_run_at) > now && daily.status === 'PENDING'),
  };
}

let first;
let loop;
let summary;
try {
  runMigrations();
  first = runTasks();
  const firstSummary = parseSummary(first);
  const firstRows = inspectRows();
  loop = runTasks(['--loop']);
  const loopSummary = parseSummary(loop);
  const loopRows = inspectRows();
  const passed = first.status === 0 && loop.status === 0 && firstSummary.claimed === 6 && firstSummary.done === 6 && firstSummary.failed === 0 && loopSummary.claimed === 0 && loopSummary.failed === 0 && firstRows.registeredTaskCount === 7 && firstRows.executedDueCount === 6 && firstRows.runningCount === 0 && firstRows.failedCount === 0 && firstRows.dailyBackupDeferred && loopRows.executedDueCount === 6 && loopRows.runningCount === 0;
  summary = {
    platform: process.platform,
    node: process.version,
    passed,
    first: { exitCode: first.status, summary: firstSummary, rows: firstRows },
    loop: { exitCode: loop.status, summary: loopSummary, rows: loopRows },
    externalServicesDisabled: true,
    isolatedDatabase: true,
    isolatedStorage: true,
    sourceState: 'local working tree; not deployed',
  };
  console.log(JSON.stringify(summary));
  if (!passed) process.exitCode = 1;
} catch (error) {
  summary = { platform: process.platform, node: process.version, passed: false, error: error instanceof Error ? error.message : String(error), sourceState: 'local working tree; not deployed' };
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
} finally {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const docPath = join(root, 'artifacts/validation-tasks.json');
  let document = { sourceState: 'local working tree; not deployed', runs: {} };
  try { document = JSON.parse(readFileSync(docPath, 'utf8')); } catch {}
  document.runs ??= {};
  document.runs[process.platform === 'win32' ? 'windows' : process.platform] = summary;
  writeFileSync(docPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  rmSync(dir, { recursive: true, force: true });
}
