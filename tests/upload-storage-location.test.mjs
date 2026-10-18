import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import bcrypt from 'bcryptjs';

const parent = path.resolve('prisma/backups'); await mkdir(parent, { recursive: true });
const dir = await mkdtemp(path.join(parent, 'upload-location-'));
const database = path.join(dir, 'source.db');
process.env.DATABASE_URL = `file:${database.split(path.sep).join('/')}`;
process.env.UPLOADS_DIRECTORY = path.join(dir, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = { ...process.env }; delete env.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, encoding: 'utf8' });
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
const { db, pragmasReady } = await import('../src/lib/db.ts'); await pragmasReady;
const { saveAccountUpload, uploadDirectory } = await import('../src/lib/uploads/storage-service.ts');
const { readVisibleUpload } = await import('../src/lib/uploads/read-service.ts');
const { validatePostImages } = await import('../src/lib/posts/validation.ts');
const { closeAccount } = await import('../src/lib/accounts/closure-service.ts');

test.after(async () => {
  await db.$disconnect(); assert(path.resolve(dir).startsWith(parent + path.sep));
  await rm(dir, { recursive: true, force: true });
});

test('custom recovered upload location supports save, private read, attachments and account cleanup', async () => {
  const password = `LocalOnly!${randomUUID()}`;
  const a = await db.user.create({ data: { username: 'location-a', email: 'location-a@example.invalid', passwordHash: await bcrypt.hash(password, 10) } });
  const b = await db.user.create({ data: { username: 'location-b', email: 'location-b@example.invalid', passwordHash: 'synthetic-only' } });
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const own = await saveAccountUpload(a.id, new File([bytes], 'own.png', { type: 'image/png' }));
  const foreign = await saveAccountUpload(b.id, new File([bytes], 'foreign.png', { type: 'image/png' }));
  const ownName = own.url.split('/').at(-1), foreignName = foreign.url.split('/').at(-1);
  assert.deepEqual(await readFile(path.join(uploadDirectory(), ownName)), bytes);
  await assert.rejects(stat(path.resolve('public/uploads', ownName)), { code: 'ENOENT' });
  assert.deepEqual((await readVisibleUpload(ownName, a.id)).bytes, bytes);
  await assert.rejects(readVisibleUpload(ownName, null), /不存在/);
  assert.deepEqual(await validatePostImages([own.url], a.id), [own.url]);
  await assert.rejects(validatePostImages([foreign.url], a.id), /自己上传/);
  const result = await closeAccount(a.id, { password, confirmation: '注销我的账号', acknowledgeRetention: true });
  assert.equal(result.closed, true); assert.equal(result.fileCleanupPending, false);
  await assert.rejects(stat(path.join(uploadDirectory(), ownName)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(uploadDirectory(), foreignName)), bytes);
  await assert.rejects(readVisibleUpload(ownName, a.id), /不存在/);
});
