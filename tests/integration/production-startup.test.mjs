import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';

const root = path.resolve(import.meta.dirname, '../..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(url) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try { return await fetch(url, {signal: controller.signal}); } catch { await sleep(500); }
    finally { clearTimeout(timer); }
  }
  throw new Error(`startup request timed out: ${url}`);
}
function directChildren(pid) {
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`], {encoding: 'utf8'}).trim()
      : execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], {encoding: 'utf8'}).trim();
    if (!raw) return [];
    if (process.platform !== 'win32') return raw.split(/\s+/).map(Number).filter(Number.isInteger);
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
  } catch { return []; }
}

test('formal production entry starts isolated api/admin/web/worker', async t => {
  const ports = {web: 3430, admin: 3431, api: 3432};
  for (const [app, dist] of Object.entries({web: '.next-build', admin: '.next-admin', api: '.next-api'})) {
    assert.ok(existsSync(path.join(root, 'apps', app, dist, 'BUILD_ID')), `Build ${app} before running test:startup`);
  }
  for (const port of Object.values(ports)) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'rumiai-production-'));
  const dbPath = path.join(dir, 'database.sqlite');
  const uploads = path.join(dir, 'uploads');
  const backups = path.join(dir, 'backups');
  await mkdir(uploads); await mkdir(backups);
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: `file:${dbPath.replaceAll('\\', '/')}`,
    UPLOADS_DIRECTORY: uploads,
    BACKUPS_DIRECTORY: backups,
    JWT_SECRET: 'isolated-production-only-secret-0123456789',
    OPENAI_API_KEY: '',
    DISABLE_MOCK_AI: 'true',
    EZFP_ENABLED: 'false',
    EZFP_REFUNDS_ENABLED: 'false',
    EZFP_PID: '',
    EZFP_MERCHANT_PRIVATE_KEY: '',
    EZFP_PLATFORM_PUBLIC_KEY: '',
    STORY_WORKER_DISABLED: '1',
    WEB_PORT: String(ports.web), ADMIN_PORT: String(ports.admin), API_PORT: String(ports.api),
    INTERNAL_API_ORIGIN: `http://127.0.0.1:${ports.api}`,
    ADMIN_API_INTERNAL_URL: `http://127.0.0.1:${ports.api}`,
    INTERNAL_ADMIN_ORIGIN: `http://127.0.0.1:${ports.admin}`,
  };
  const init = spawnSync(process.execPath, ['ops/scripts/initialize-db.mjs'], {cwd: root, env, encoding: 'utf8'});
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  assert.equal(existsSync(dbPath), true);

  const child = spawn(process.execPath, ['ops/scripts/start-production.mjs'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let ownedChildren = [];
  t.after(async () => {
    ownedChildren = directChildren(child.pid);
    // On Windows SIGTERM maps to process termination. Kill the recorded tree
    // while the root is still alive; this is explicit test cleanup, not graceful shutdown.
    if (process.platform === 'win32' && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    else if (child.exitCode === null) child.kill('SIGTERM');
    const deadline = Date.now() + 8000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(100);
    if (process.platform !== 'win32' && child.exitCode === null) for (const pid of ownedChildren) try { process.kill(pid, 'SIGKILL'); } catch {}
    await rm(dir, {recursive: true, force: true});
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const [api, admin, web] = await Promise.all([
    get(`http://127.0.0.1:${ports.api}/api/memberships`),
    get(`http://127.0.0.1:${ports.admin}/admin/login`),
    // Static web readiness avoids build-time API rewrites aimed at the deployed service.
    get(`http://127.0.0.1:${ports.web}/manifest.webmanifest`),
  ]);
  assert.equal(api.status, 200);
  assert.equal(admin.status, 200);
  assert.equal(web.status, 200);
  await sleep(1500);
  assert.equal(child.exitCode, null, `root startup exited: ${stdout}\n${stderr}`);
  assert.equal((stdout + stderr).split('worker_started').length - 1, 1, 'exactly one worker runner must start');
  assert.ok(directChildren(child.pid).length >= 4, 'root must own api/admin/web/worker children');

  const db = new DatabaseSync(dbPath);
  try {
    const tasks = db.prepare('SELECT kind,status,next_run_at FROM background_tasks ORDER BY kind').all();
    assert.ok(tasks.length >= 7, 'worker must register the seven sweep tasks');
    assert.equal(tasks.filter(row => row.status === 'RUNNING').length, 0, 'initial due tasks must not remain RUNNING');
    const due = tasks.filter(row => new Date(row.next_run_at).getTime() <= Date.now());
    assert.equal(due.length, 0, 'the first due sweep batch must be rescheduled beyond now');
  } finally { db.close(); }
});
