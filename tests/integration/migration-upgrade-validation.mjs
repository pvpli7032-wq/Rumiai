import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';

const root = resolve(import.meta.dirname, '../..');
const baselineCommit = 'c091ed6133d536d94c4b938b3e5ed335a23ac4e1';
const migrationsRoot = join(root, 'database/migrations');
const migrations = readdirSync(migrationsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const baselineListResult = spawnSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, '--', 'prisma/migrations'], { cwd: root, encoding: 'utf8' });
if (baselineListResult.status !== 0) throw new Error(baselineListResult.stderr || 'unable to read audited baseline migration list');
const baselineNames = [...new Set(baselineListResult.stdout.trim().split(/\r?\n/).filter(name => name.endsWith('/migration.sql')).map(name => name.split('/')[2]))].sort();
if (baselineNames.length !== 52) throw new Error(`audited baseline expected 52 migrations, found ${baselineNames.length}`);
for (const name of baselineNames) if (!migrations.includes(name)) throw new Error(`baseline migration missing from current tree: ${name}`);
const expectedCurrentMigrations = ['20261023120000_memberships', '20261023170000_account_recovery', '20261023190000_message_media_and_package_benefits', '20261023210000_growth_modules_ai_price_tiers', '20261023220000_referrals_affiliate'];
const currentMigrations = migrations.filter(name => !baselineNames.includes(name));
if (JSON.stringify(currentMigrations) !== JSON.stringify(expectedCurrentMigrations)) throw new Error(`unexpected current migration set: ${currentMigrations.join(', ')}`);
const dir = mkdtempSync(join(tmpdir(), 'rumiai-migration-upgrade-'));
const dbPath = join(dir, 'upgrade.sqlite');
const databaseUrl = `file:${dbPath.replaceAll('\\', '/')}`;

function gitSql(name) {
  const shown = spawnSync('git', ['show', `${baselineCommit}:prisma/migrations/${name}/migration.sql`], { cwd: root, encoding: 'utf8' });
  if (shown.status !== 0) throw new Error(shown.stderr || `unable to read baseline SQL: ${name}`);
  const current = readFileSync(join(migrationsRoot, name, 'migration.sql'), 'utf8');
  if (createHash('sha256').update(shown.stdout).digest('hex') !== createHash('sha256').update(current).digest('hex')) throw new Error(`baseline SQL changed: ${name}`);
  return shown.stdout;
}

function applyBaseline() {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE IF NOT EXISTS _prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL, applied_steps_count INTEGER NOT NULL DEFAULT 0);');
  for (const name of baselineNames) {
    const sql = gitSql(name);
    db.exec(sql);
    const now = Date.now();
    db.prepare('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)').run(createHash('sha256').update(name).digest('hex'), createHash('sha256').update(sql).digest('hex'), now, name, now);
  }
  // Simulate a real pre-membership database: one user and one setting already exist.
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('upgrade-user-1', 'upgrade-user', 'upgrade@example.test', 'migration-fixture', '保留用户', Date.now());
  db.prepare('INSERT INTO operation_settings (key, "group", value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)').run('billing.freeDailyMessages', 'billing', '3', 'upgrade-user-1', Date.now());
  db.close();
}

let result;
let prisma;
try {
  applyBaseline();
  const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
  delete env.DATABASE_URL_ORIGINAL;
  result = spawnSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'database/schema.prisma'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `prisma migrate deploy exited ${result.status}`);
  process.env.DATABASE_URL = databaseUrl;
  prisma = new PrismaClient();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-user-1' } });
  const setting = await prisma.operationSetting.findUniqueOrThrow({ where: { key: 'billing.freeDailyMessages' } });
  const migrationCount = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM _prisma_migrations');
  const membershipTables = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('membership_plans','membership_orders','membership_grants','membership_usage','membership_refunds','membership_policies')");
  const recoveryTables = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='account_action_tokens'");
  const referralTables = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('invite_codes','referral_relationships','affiliate_accruals','affiliate_reversals')");
  result = { platform: process.platform, node: process.version, passed: user.email === 'upgrade@example.test' && user.emailVerifiedAt === null && setting.value === '3' && Number(migrationCount[0].count) === migrations.length && Number(membershipTables[0].count) === 6 && Number(recoveryTables[0].count) === 1 && Number(referralTables[0].count) === 4, baselineCommit, baselineMigrations: baselineNames.length, currentMigrations, finalMigrations: migrations.length, preservedUser: { id: user.id, email: user.email }, preservedSetting: { key: setting.key, value: setting.value }, membershipTableCount: Number(membershipTables[0].count), recoveryTableCount: Number(recoveryTables[0].count), referralTableCount: Number(referralTables[0].count), sourceState: 'local working tree; not deployed' };
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result = { platform: process.platform, node: process.version, passed: false, baselineCommit, baselineMigrations: baselineNames.length, finalMigrations: migrations.length, error: error instanceof Error ? error.message : String(error), stdoutTail: (result?.stdout ?? '').slice(-2000), stderrTail: (result?.stderr ?? '').slice(-2000), sourceState: 'local working tree; not deployed' };
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect().catch(() => {});
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs/validation-migration-upgrade.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  rmSync(dir, { recursive: true, force: true });
}
