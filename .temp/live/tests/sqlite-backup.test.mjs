import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { backupSqliteDatabase, restoreSqliteDatabase, resolveSqliteSource, inspectSqliteSnapshot } from '../src/lib/operations/sqlite-backup.mjs';

const root = process.cwd();
const url = file => `file:${file.split(path.sep).join('/')}`;

test('SQLite backup and recovery drill uses an isolated migrated database', async t => {
  const parent = path.resolve(root, 'prisma', 'backups');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'recovery-test-'));
  const source = path.join(dir, 'source.db'), backup = path.join(dir, "snapshot's.db"), restored = path.join(dir, 'restored.db');
  const env = { ...process.env, DATABASE_URL: url(source) };
  delete env.RUST_LOG;
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const db = new PrismaClient({ datasources: { db: { url: url(source) } } });
  let recovered;
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await db.$queryRawUnsafe('PRAGMA wal_autocheckpoint = 0');
    const user = await db.user.create({ data: { username: 'local-recovery', email: 'recovery@example.invalid', passwordHash: 'synthetic-test-only', coins: 75 } });
    const character = await db.character.create({ data: { name: '恢复演练角色', personality: '原创测试角色', background: '仅用于隔离测试', creatorId: user.id } });
    const conversation = await db.conversation.create({ data: { userId: user.id, characterId: character.id } });
    await db.message.create({ data: { conversationId: conversation.id, role: 'USER', content: '只存在于隔离数据库中的测试消息' } });
    await db.coinTransaction.create({ data: { userId: user.id, type: 'EARNED', amount: 75, description: 'synthetic recovery fixture' } });

    await t.test('backup includes committed WAL and reports snapshot counts', async () => {
      assert((await stat(source + '-wal')).size > 0, 'must exercise committed WAL');
      const report = await backupSqliteDatabase(source, backup);
      assert.equal(report.integrity, 'ok');
      assert.equal(report.foreignKeys, 'ok');
      assert.equal(report.counts.users, 1);
      assert.equal(report.counts.messages, 1);
      assert.equal(report.counts.coin_transactions, 1);
      const migrationNames = (await readdir(path.join(root, 'prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      assert.equal(report.counts._prisma_migrations, migrationNames.length);
      assert.deepEqual((await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name')).map(row => row.migration_name), migrationNames);
      await db.user.update({ where: { id: user.id }, data: { coins: 100 } });
      assert.equal((await inspectSqliteSnapshot(backup)).counts.users, 1);
    });

    await t.test('restored copy preserves chat, balances, ledger and migrations and remains writable', async () => {
      const result = await restoreSqliteDatabase(backup, restored);
      assert.equal(result.counts.messages, 1);
      recovered = new PrismaClient({ datasources: { db: { url: url(restored) } } });
      assert.equal((await recovered.user.findUniqueOrThrow({ where: { id: user.id } })).coins, 75, 'restore the snapshot, not later source changes');
      assert.equal((await recovered.message.findFirstOrThrow()).content, '只存在于隔离数据库中的测试消息');
      assert.equal((await recovered.coinTransaction.findFirstOrThrow()).amount, 75);
      assert.deepEqual(await recovered.$queryRawUnsafe('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name'), await db.$queryRawUnsafe('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name'));
      await recovered.user.update({ where: { id: user.id }, data: { displayName: '恢复后可写入' } });
      assert.equal((await recovered.user.findUniqueOrThrow({ where: { id: user.id } })).displayName, '恢复后可写入');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins, 100, 'source stays independent');
    });

    await t.test('existing targets and their sidecars cannot be overwritten', async () => {
      const bytes = await readFile(backup);
      await assert.rejects(backupSqliteDatabase(source, backup), /拒绝覆盖/);
      assert.deepEqual(await readFile(backup), bytes);
      await assert.rejects(restoreSqliteDatabase(backup, restored), /拒绝覆盖/);
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const target = path.join(dir, `occupied${suffix}.db`);
        await writeFile(target + suffix, 'untouched');
        await assert.rejects(restoreSqliteDatabase(backup, target), /拒绝覆盖/);
        assert.equal(await readFile(target + suffix, 'utf8'), 'untouched');
      }
    });

    await t.test('missing or corrupt backups fail without creating recovery output', async () => {
      const corrupt = path.join(dir, 'corrupt.db');
      await writeFile(corrupt, 'not a SQLite database');
      for (const file of [corrupt, path.join(dir, 'missing.db')]) {
        const target = path.join(dir, `invalid-${path.basename(file)}`);
        await assert.rejects(restoreSqliteDatabase(file, target));
        await assert.rejects(stat(target), { code: 'ENOENT' });
      }
      await writeFile(backup + '-wal', 'not part of a single-file backup');
      await assert.rejects(restoreSqliteDatabase(backup, path.join(dir, 'unsafe.db')), /单文件备份/);
    });

    await t.test('CLI rejects unsafe labels and invalid configuration before creating a database', async () => {
      assert.equal(resolveSqliteSource('file:./dev.db', root), path.join(root, 'prisma', 'dev.db'));
      assert.throws(() => resolveSqliteSource(undefined), /DATABASE_URL/);
      assert.throws(() => resolveSqliteSource('postgresql://invalid'), /SQLite/);
      const result = spawnSync(process.execPath, ['scripts/backup-db.mjs', '../escape'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /备份标签/);
      const restore = spawnSync(process.execPath, ['scripts/restore-db.mjs'], { cwd: root, encoding: 'utf8' });
      assert.equal(restore.status, 1);
      assert.match(restore.stderr, /用法/);
    });
  } finally {
    await recovered?.$disconnect();
    await db.$disconnect();
    // Only the unique directory created by this test is removed.
    assert(path.resolve(dir).startsWith(parent + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
