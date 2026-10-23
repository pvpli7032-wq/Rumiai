import {mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
if (process.env.DATABASE_URL || process.env.MEMBERSHIP_INTEGRATION_DB) {
  throw new Error('runner refuses externally supplied DATABASE_URL/MEMBERSHIP_INTEGRATION_DB; it owns every temporary database');
}

const tests = [
  'tests/integration/membership-core.test.ts',
  'tests/integration/membership-benefits.test.ts',
  'tests/integration/membership-payments.test.ts',
  'tests/integration/membership-workflow.test.ts',
  'tests/integration/membership-billing.test.ts',
  'tests/integration/membership-character.test.ts',
  'tests/integration/membership-routes.test.ts',
  'tests/integration/membership-finance.test.ts',
];
const migrations = readdirSync(join(root, 'database/migrations'), {withFileTypes: true})
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

function migrate(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  for (const name of migrations) db.exec(readFileSync(join(root, 'database/migrations', name, 'migration.sql'), 'utf8'));
  db.close();
}

function counts(output) {
  const match = output.match(/(?:#|ℹ) tests (\d+)[\s\S]*?(?:#|ℹ) pass (\d+)[\s\S]*?(?:#|ℹ) fail (\d+)[\s\S]*?(?:#|ℹ) cancelled (\d+)[\s\S]*?(?:#|ℹ) skipped (\d+)/);
  return match ? {tests: Number(match[1]), pass: Number(match[2]), fail: Number(match[3]), cancelled: Number(match[4]), skipped: Number(match[5])} : null;
}

const results = [];
for (const relative of tests) {
  try { readFileSync(join(root, relative)); } catch {
    results.push({test: relative, status: 'failed', exitCode: null, counts: {tests: 0, pass: 0, fail: 1, cancelled: 0, skipped: 0, source: 'required test file missing'}});
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), 'rumiai-membership-'));
  const dbPath = join(dir, 'membership.sqlite');
  try {
    migrate(dbPath);
    const env = {...process.env, DATABASE_URL: `file:${dbPath}`, MEMBERSHIP_INTEGRATION_DB: `file:${dbPath}`, NODE_ENV: 'test'};
    const run = spawnSync(process.execPath, ['--experimental-default-type=module', '--test', '--test-reporter=tap', '--import', 'tsx', relative], {cwd: root, env, encoding: 'utf8'});
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const parsed = counts(output);
    const summary = parsed ?? {tests: 0, pass: 0, fail: 1, cancelled: 0, skipped: 0, source: 'missing node:test TAP summary'};
    results.push({test: relative, status: run.status === 0 && parsed && summary.fail === 0 && summary.skipped === 0 ? 'passed' : 'failed', exitCode: run.status, counts: summary});
    console.info(`${relative}: ${summary.pass}/${summary.tests} passed; ${summary.fail} failed; ${summary.skipped} skipped`);
    if (run.status !== 0) process.stderr.write(output);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const summary = {generatedAt: new Date().toISOString(), platform: process.platform, node: process.version, migrationCount: migrations.length, database: 'temporary SQLite per test; removed after each run', sourceState: 'local working tree; not deployed', results};
const outPath = join(root, 'docs/validation-memberships.json');
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.info(`Validation report: ${outPath}`);
if (results.some(result => result.status !== 'passed' || !result.counts || result.counts.fail > 0 || result.counts.skipped > 0)) process.exitCode = 1;
