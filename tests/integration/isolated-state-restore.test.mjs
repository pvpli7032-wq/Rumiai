import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createFixture } from '../helpers/sqlite-fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('state backup and restore uses a new isolated database and upload tree', async t => {
  const fixture = await createFixture();
  t.after(async () => fixture.cleanup());

  const uploads = path.join(fixture.dir, 'uploads');
  const backupRoot = path.join(fixture.dir, 'backupdir');
  const restoreRoot = path.join(fixture.dir, 'restored');
  await mkdir(uploads);
  const uploadBytes = Buffer.from('isolated restore fixture\n', 'utf8');
  await writeFile(path.join(uploads, 'fixture.txt'), uploadBytes, { flag: 'wx' });
  await fixture.db.user.update({where: {id: fixture.user.id}, data: {avatarUrl: '/uploads/fixture.txt'}});
  await fixture.disconnect();

  const env = {
    ...process.env,
    RUMIAI_PROJECT_ROOT: root,
    DATABASE_URL: `file:${fixture.dbPath.replaceAll('\\', '/')}`,
    UPLOADS_DIRECTORY: uploads,
    BACKUPS_DIRECTORY: backupRoot,
  };
  const backup = spawnSync(process.execPath, ['ops/scripts/backup-state.mjs', 'isolated-restore'], {
    cwd: root, env, encoding: 'utf8'
  });
  assert.equal(backup.status, 0, `${backup.stdout}\n${backup.stderr}`);
  const backupDir = path.join(backupRoot, 'e2e-isolated-restore');
  assert.equal(existsSync(path.join(backupDir, 'manifest.json')), true);
  const sourceHashBeforeRestore = sha256(await readFile(fixture.dbPath));

  const restore = spawnSync(process.execPath, ['ops/scripts/restore-state.mjs', backupDir, restoreRoot], {
    cwd: root, env, encoding: 'utf8'
  });
  assert.equal(restore.status, 0, `${restore.stdout}\n${restore.stderr}`);

  const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  const restoredDatabase = path.join(restoreRoot, 'database.db');
  const restoredUpload = path.join(restoreRoot, 'uploads', 'fixture.txt');
  assert.equal(manifest.uploads.length, 1);
  assert.equal(manifest.referenceCount, 1, 'the database upload reference must survive joint backup');
  assert.equal(manifest.uploads[0].name, 'fixture.txt');
  assert.equal(manifest.uploads[0].sha256, sha256(uploadBytes));
  assert.equal(sha256(await readFile(restoredUpload)), manifest.uploads[0].sha256);
  assert.equal(sha256(await readFile(restoredDatabase)), manifest.database.sha256);

  const restored = new DatabaseSync(restoredDatabase);
  try {
    const users = restored.prepare('SELECT username FROM users ORDER BY username').all();
    assert.deepEqual(users.map(row => row.username), ['e2e-admin', 'e2e-user']);
    assert.equal(restored.prepare('SELECT avatar_url FROM users WHERE id = ?').get(fixture.user.id).avatar_url, '/uploads/fixture.txt');
  } finally {
    restored.close();
  }
  assert.notEqual(path.resolve(restoredDatabase), path.resolve(fixture.dbPath));
  assert.equal(existsSync(fixture.dbPath), true, '原始临时数据库不得被覆盖');
  assert.equal(sha256(await readFile(fixture.dbPath)), sourceHashBeforeRestore, 'restore must not modify the source database');
  const duplicate = spawnSync(process.execPath, ['ops/scripts/restore-state.mjs', backupDir, restoreRoot], {cwd: root, env, encoding: 'utf8'});
  assert.equal(duplicate.status, 1, 'an existing restore target must be rejected');
  assert.equal(sha256(await readFile(restoredDatabase)), manifest.database.sha256, 'rejected restore must not overwrite existing data');
});
