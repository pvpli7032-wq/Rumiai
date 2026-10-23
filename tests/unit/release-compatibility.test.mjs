import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {assertReleaseCompatible} from '../../ops/scripts/check-release.mjs';

test('release gate reads database/migrations and blocks pending, unexpected and failed migrations', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rumiai-release-gate-'));
  const filename = path.join(directory, 'release.sqlite');
  const client = new DatabaseSync(filename);
  client.exec('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at INTEGER, rolled_back_at INTEGER)');
  const insert = client.prepare('INSERT INTO _prisma_migrations VALUES (?, ?, ?)');
  mkdirSync(path.join(directory, 'database/migrations/first'), {recursive: true});
  mkdirSync(path.join(directory, 'database/migrations/second'), {recursive: true});
  try {
    insert.run('first', 1, null);
    await assert.rejects(() => assertReleaseCompatible(filename, directory), error => error.report.pendingCount === 1);
    insert.run('second', 2, null);
    assert.equal((await assertReleaseCompatible(filename, directory)).appliedCount, 2);
    insert.run('unknown', 3, null);
    await assert.rejects(() => assertReleaseCompatible(filename, directory), error => error.report.unexpectedCount === 1);
    client.exec("DELETE FROM _prisma_migrations WHERE migration_name = 'unknown'");
    insert.run('failed-attempt', null, null);
    await assert.rejects(() => assertReleaseCompatible(filename, directory), error => error.report.failedCount === 1);
    client.exec("UPDATE _prisma_migrations SET rolled_back_at = 4 WHERE migration_name = 'failed-attempt'");
    assert.equal((await assertReleaseCompatible(filename, directory)).failedCount, 0);
    assert.equal(client.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations').get().count, 3, 'read-only gate must not rewrite migration history');
  } finally {
    client.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
