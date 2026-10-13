import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rmdir, stat } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { createStateBackup, inspectStateBackup, restoreStateBackup } from '../src/lib/operations/state-backup.mjs';
import { uploadDirectory } from '../src/lib/uploads/storage-location.mjs';

const root = process.cwd(), parent = path.resolve('prisma/backups');
const fileUrl = file => `file:${file.split(path.sep).join('/')}`;

test('full state recovery preserves database and private/legacy uploads without replacing live data', async t => {
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'state-drill-'));
  const source = path.join(dir, 'source.db'), uploads = path.join(dir, 'source-uploads');
  const backup = path.join(dir, 'backup'), recovered = path.join(dir, 'recovered');
  const env = { ...process.env, DATABASE_URL: fileUrl(source) }; delete env.RUST_LOG;
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  const db = new PrismaClient({ datasources: { db: { url: fileUrl(source) } }, log: [] });
  let restored;
  try {
    await mkdir(uploads);
    await writeFile(path.join(dir, '.env'), 'SYNTHETIC_PRIVATE_CONFIG_MUST_NOT_BE_COPIED');
    await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await db.$queryRawUnsafe('PRAGMA wal_autocheckpoint = 0');
    const user = await db.user.create({ data: { username: 'state-owner', email: 'state@example.invalid', passwordHash: 'synthetic-only', coins: 73 } });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    await writeFile(path.join(uploads, 'owned.png'), png); await writeFile(path.join(uploads, 'legacy.png'), png);
    await db.uploadAsset.create({ data: { ownerId: user.id, url: '/uploads/owned.png' } });
    const role = await db.character.create({ data: { creatorId: user.id, name: '恢复角色', personality: '仅本地测试', background: '隔离恢复演练', avatarUrl: '/uploads/legacy.png' } });
    const conversation = await db.conversation.create({ data: { userId: user.id, characterId: role.id } });
    await db.message.create({ data: { conversationId: conversation.id, role: 'USER', content: 'SYNTHETIC_CHAT', imageUrl: '/uploads/owned.png' } });
    await db.coinTransaction.create({ data: { userId: user.id, type: 'EARNED', amount: 73, description: 'synthetic state drill' } });

    await t.test('snapshot includes WAL rows, all upload bytes, checksums and legacy references, but no config', async () => {
      const report = await createStateBackup(source, uploads, backup);
      assert.equal(report.counts.users, 1); assert.equal(report.counts.messages, 1);
      assert.equal(report.manifest.referenceCount, 2); assert.equal(report.manifest.uploads.length, 2);
      assert.deepEqual(await readFile(path.join(backup, 'uploads/owned.png')), png);
      await assert.rejects(stat(path.join(backup, '.env')), { code: 'ENOENT' });
      assert(!JSON.stringify(report.manifest).includes('SYNTHETIC_CHAT'));
    });
    await t.test('restore uses a new target and retains attachment ownership, balances and messages', async () => {
      await db.user.update({ where: { id: user.id }, data: { coins: 99 } });
      const result = await restoreStateBackup(backup, recovered);
      restored = new PrismaClient({ datasources: { db: { url: fileUrl(result.database) } }, log: [] });
      assert.equal((await restored.user.findUnique({ where: { id: user.id } })).coins, 73);
      assert.equal((await db.user.findUnique({ where: { id: user.id } })).coins, 99);
      assert.equal((await restored.message.findFirst()).content, 'SYNTHETIC_CHAT');
      assert.equal((await restored.uploadAsset.findFirst()).ownerId, user.id);
      assert.deepEqual(await readFile(path.join(result.uploads, 'legacy.png')), png);
      await restored.$disconnect(); restored = undefined;
      await assert.rejects(restoreStateBackup(backup, recovered), { code: 'EEXIST' });
      await assert.rejects(createStateBackup(source, uploads, backup), { code: 'EEXIST' });
    });
    await t.test('tampered bytes and path-traversal manifest are rejected before target creation', async () => {
      const file = path.join(backup, 'uploads/owned.png');
      await writeFile(file, 'changed');
      const rejected = path.join(dir, 'tampered-target');
      await assert.rejects(restoreStateBackup(backup, rejected), /SHA256/);
      await assert.rejects(stat(rejected), { code: 'ENOENT' });
      await writeFile(file, png);
      const manifestFile = path.join(backup, 'manifest.json'), original = await readFile(manifestFile, 'utf8');
      const manifest = JSON.parse(original); manifest.uploads[0].name = '../../outside.png';
      await writeFile(manifestFile, JSON.stringify(manifest));
      await assert.rejects(inspectStateBackup(backup), /清单/);
      await writeFile(manifestFile, original);
    });
    await t.test('missing referenced files and unexpected upload directories cannot publish a valid backup', async () => {
      await rm(path.join(uploads, 'owned.png'));
      const incomplete = path.join(dir, 'incomplete');
      await assert.rejects(createStateBackup(source, uploads, incomplete), /缺失/);
      await assert.rejects(stat(path.join(incomplete, 'manifest.json')), { code: 'ENOENT' });
      await writeFile(path.join(uploads, 'owned.png'), png); await mkdir(path.join(uploads, 'nested'));
      await assert.rejects(createStateBackup(source, uploads, path.join(dir, 'nested-source')), /子目录/);
      await rmdir(path.join(uploads, 'nested'));
    });
    await t.test('storage defaults are preserved and recovery can point to a separate directory', () => {
      const original = process.env.UPLOADS_DIRECTORY;
      try {
        delete process.env.UPLOADS_DIRECTORY; assert.equal(uploadDirectory(root), path.join(root, 'public/uploads'));
        process.env.UPLOADS_DIRECTORY = path.join(recovered, 'uploads'); assert.equal(uploadDirectory(root), path.join(recovered, 'uploads'));
      } finally { if (original === undefined) delete process.env.UPLOADS_DIRECTORY; else process.env.UPLOADS_DIRECTORY = original; }
    });
  } finally {
    await restored?.$disconnect(); await db.$disconnect();
    assert(path.resolve(dir).startsWith(parent + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
