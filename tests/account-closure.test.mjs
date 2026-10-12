import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file = `account-close-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = '';
process.env.EZFP_ENABLED = 'false';
const env = { ...process.env }; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, encoding: 'utf8' });
assert.equal(migration.status, 0, migration.stdout + migration.stderr);
const { db, pragmasReady } = await import('../src/lib/db.ts');
await pragmasReady;
const { POST: close } = await import('../src/app/api/users/me/close/route.ts');
const { POST: login } = await import('../src/app/api/auth/login/route.ts');
const { GET: exportData } = await import('../src/app/api/users/me/export/route.ts');
const { signToken, getAuthUser } = await import('../src/lib/auth.ts');
const { saveAccountUpload } = await import('../src/lib/uploads/storage-service.ts');
const { finishClosureFileCleanup } = await import('../src/lib/uploads/privacy.ts');
const { readVisibleUpload } = await import('../src/lib/uploads/read-service.ts');
const { validatePostImages } = await import('../src/lib/community-posts.ts');
const testFiles = new Set();
test.after(async () => {
  await db.$disconnect();
  for (const target of testFiles) {
    assert.equal(path.dirname(target), path.resolve('public/uploads'));
    await rm(target, { force: true });
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path.resolve('prisma', file + suffix), { force: true });
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function request(token, body) { return new Request('http://localhost/api/users/me/close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }

test('account closure erases own data, preserves foreign data and audit, revokes login and prevents late writes', async t => {
  const password = `LocalOnly!${randomUUID()}`;
  const a = await db.user.create({ data: { username: 'closing-a', email: 'closing-a@example.invalid', passwordHash: await bcrypt.hash(password, 10), coins: 321 } });
  const b = await db.user.create({ data: { username: 'closing-b', email: 'closing-b@example.invalid', passwordHash: 'foreign-hash' } });
  const token = await signToken({ userId: a.id, email: a.email, tokenVersion: a.tokenVersion });
  const body = { password, confirmation: '注销我的账号', acknowledgeRetention: true, userId: b.id };
  const uploads = [];
  for (const userId of [a.id, b.id]) {
    const asset = await saveAccountUpload(userId, new File([png], 'pixel.png', { type: 'image/png' }));
    uploads.push(asset); testFiles.add(path.resolve('public', asset.url.slice(1)));
  }
  assert.notEqual(uploads[0].url, uploads[1].url, 'same image in different accounts must have independent ownership');
  const legacyUrl = `/uploads/legacy-${randomUUID()}.png`, legacyFile = path.resolve('public', legacyUrl.slice(1));
  await mkdir(path.dirname(legacyFile), { recursive: true }); await writeFile(legacyFile, png); testFiles.add(legacyFile);
  await db.user.update({ where: { id: a.id }, data: { avatarUrl: legacyUrl } });
  await db.user.update({ where: { id: b.id }, data: { avatarUrl: legacyUrl } });
  const ownRole = await db.character.create({ data: { creatorId: a.id, name: 'OWN_PERSONAL_NAME', personality: 'OWN_PRIVATE_PERSONA', background: 'OWN_STORY', isPublic: false, reviewStatus: 'DRAFT', avatarUrl: uploads[0].url } });
  const foreignRole = await db.character.create({ data: { creatorId: b.id, name: 'Foreign', personality: 'FOREIGN_PERSONA', background: '' } });
  const ownChat = await db.conversation.create({ data: { userId: a.id, characterId: foreignRole.id, messages: { create: { role: 'USER', content: 'OWN_PRIVATE_CHAT' } } } });
  const foreignChat = await db.conversation.create({ data: { userId: b.id, characterId: ownRole.id, messages: { create: { role: 'USER', content: 'FOREIGN_PRIVATE_CHAT' } } } });
  const circle = await db.circle.create({ data: { ownerId: a.id, name: 'OWN_PERSONAL_CIRCLE', description: 'OWN_DESCRIPTION', members: { create: [{ userId: a.id }, { userId: b.id }] } } });
  const post = await db.post.create({ data: { circleId: circle.id, authorId: a.id, content: 'OWN_POST', comments: { create: { authorId: b.id, content: 'FOREIGN_REPLY' } } } });
  const report = await db.report.create({ data: { reporterId: a.id, targetType: 'CHARACTER', targetId: foreignRole.id, category: 'other', details: 'retained report', evidenceContent: 'RETAINED_EVIDENCE', contactValue: a.email } });
  const paid = await db.paymentOrder.create({ data: { userId: a.id, orderNo: `LOCAL${randomUUID()}`, idempotencyKey: randomUUID(), packageCoins: 100, packageBonus: 0, coinAmount: 100, amountCnyCents: 1000, status: 'PAID', paidAt: new Date() } });
  const ledger = await db.coinTransaction.create({ data: { userId: a.id, paymentOrderId: paid.id, amount: 100, type: 'PURCHASE' } });
  const usage = await db.aiCall.create({ data: { userId: a.id, conversationId: ownChat.id, operation: 'SEND', status: 'SUCCEEDED', estimatedCost: 0.3, currency: 'USD' } });

  await t.test('private media is owner-scoped and only the owner can make its reference public', async () => {
    assert.deepEqual(await validatePostImages([uploads[0].url], a.id), { urls: [uploads[0].url] });
    assert.match((await validatePostImages([uploads[0].url], b.id)).error, /自己上传/);
    assert.deepEqual(await validatePostImages([legacyUrl], a.id), { urls: [legacyUrl] }, 'existing own legacy references remain editable');
    assert.match((await validatePostImages([uploads[0].url, uploads[0].url], a.id)).error, /重复/);
    assert.match((await validatePostImages(['/uploads/../private.png'], a.id)).error, /站内/);
    const names = uploads.map(asset => asset.url.split('/').at(-1));
    await assert.rejects(readVisibleUpload(names[0], null), /图片不存在/);
    await assert.rejects(readVisibleUpload(names[0], b.id), /图片不存在/);
    assert.deepEqual((await readVisibleUpload(names[0], a.id)).bytes, png);
    await db.character.update({ where: { id: ownRole.id }, data: { isPublic: true, reviewStatus: 'APPROVED' } });
    assert.deepEqual((await readVisibleUpload(names[0], null)).bytes, png);
    await db.character.update({ where: { id: ownRole.id }, data: { avatarUrl: uploads[1].url } });
    await assert.rejects(readVisibleUpload(names[1], null), /图片不存在/, 'foreign public reference cannot expose a private upload');
    await db.character.update({ where: { id: ownRole.id }, data: { avatarUrl: uploads[0].url } });
  });

  await t.test('identity, confirmation, pending orders and active AI must be resolved before closure', async () => {
    assert.equal((await close(request(null, body))).status, 401);
    assert.equal((await close(request(token, { ...body, confirmation: 'wrong' }))).status, 400);
    assert.equal((await close(request(token, { ...body, password: 'wrong' }))).status, 403);
    const pending = await db.paymentOrder.create({ data: { userId: a.id, orderNo: `PENDING${randomUUID()}`, idempotencyKey: randomUUID(), packageCoins: 1, packageBonus: 0, coinAmount: 1, amountCnyCents: 1 } });
    assert.equal((await close(request(token, body))).status, 409);
    await db.paymentOrder.update({ where: { id: pending.id }, data: { status: 'CANCELLED' } });
    await db.aiCall.update({ where: { id: usage.id }, data: { status: 'STARTED' } });
    assert.equal((await close(request(token, body))).status, 409);
    await db.aiCall.update({ where: { id: usage.id }, data: { status: 'SUCCEEDED' } });
    assert.equal(await db.accountClosure.count(), 0);
  });
  let receipt;
  await t.test('closure is scoped to current identity and preserves financial and audit records', async () => {
    const response = await close(request(token, body));
    assert.equal(response.status, 200, await response.clone().text()); receipt = await response.json();
    assert.equal(receipt.fileCleanupPending, true, 'legacy shared image needs review, not deletion');
    const retired = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    assert(retired.deletedAt); assert.equal(retired.coins, 321);
    assert.notEqual(retired.email, a.email); assert.notEqual(retired.username, a.username);
    assert.equal(retired.avatarUrl, null); assert.equal(retired.tokenVersion, a.tokenVersion + 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.id } })).deletedAt, null);
    assert.equal(await db.conversation.count({ where: { id: ownChat.id } }), 0);
    assert.equal((await db.message.findFirstOrThrow({ where: { conversationId: foreignChat.id } })).content, 'FOREIGN_PRIVATE_CHAT');
    const role = await db.character.findUniqueOrThrow({ where: { id: ownRole.id } });
    assert.equal(role.personality, ''); assert.equal(role.isPublic, false);
    assert.equal((await db.character.findUniqueOrThrow({ where: { id: foreignRole.id } })).personality, 'FOREIGN_PERSONA');
    assert.equal((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content, '');
    assert.equal((await db.postComment.findFirstOrThrow({ where: { postId: post.id } })).content, 'FOREIGN_REPLY');
    assert.equal(await db.circleMember.count({ where: { circleId: circle.id, userId: b.id } }), 1);
    assert.equal((await db.coinTransaction.findUniqueOrThrow({ where: { id: ledger.id } })).amount, 100);
    assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: paid.id } })).amountCnyCents, 1000);
    assert.equal((await db.aiCall.findUniqueOrThrow({ where: { id: usage.id } })).estimatedCost, 0.3);
    const evidence = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(evidence.evidenceContent, 'RETAINED_EVIDENCE'); assert.equal(evidence.contactValue, null);
    await assert.rejects(stat(path.resolve('public', uploads[0].url.slice(1))), { code: 'ENOENT' });
    assert.deepEqual(await readFile(path.resolve('public', uploads[1].url.slice(1))), png);
    assert.deepEqual(await readFile(legacyFile), png);
  });
  await t.test('old tokens, old login, export and late content writes cannot revive the account', async () => {
    assert.equal(await getAuthUser(request(token, body)), null);
    assert.equal((await close(request(token, body))).status, 401);
    assert.equal((await exportData(new Request('http://localhost/api/users/me/export', { headers: { Authorization: `Bearer ${token}` } }))).status, 401);
    await assert.rejects(readVisibleUpload(uploads[0].url.split('/').at(-1), a.id), /图片不存在/);
    const loginRequest = new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password }) });
    assert.equal((await login(loginRequest)).status, 401);
    for (const write of [
      () => db.conversation.create({ data: { userId: a.id, characterId: foreignRole.id } }),
      () => db.character.create({ data: { creatorId: a.id, name: 'Late', personality: 'revived', background: '' } }),
      () => db.post.create({ data: { circleId: circle.id, authorId: a.id, content: 'Late' } }),
      () => db.character.update({ where: { id: ownRole.id }, data: { personality: 'revived' } }),
      () => db.user.update({ where: { id: a.id }, data: { avatarUrl: uploads[0].url } }),
    ]) await assert.rejects(write());
    await assert.rejects(saveAccountUpload(a.id, new File([png], 'pixel.png', { type: 'image/png' })), /账号已注销/);
  });
  await t.test('legacy shared-file cleanup can be retried after references are removed', async () => {
    await db.user.update({ where: { id: b.id }, data: { avatarUrl: null } });
    assert.equal(await finishClosureFileCleanup(receipt.reference), 'COMPLETED');
    assert.equal(await finishClosureFileCleanup(receipt.reference), 'COMPLETED');
    await assert.rejects(stat(legacyFile), { code: 'ENOENT' });
    assert.equal((await db.accountClosure.findUniqueOrThrow({ where: { id: receipt.reference } })).status, 'COMPLETED');
  });
  await t.test('upload MIME must match bytes, and unsupported formats do not create assets', async () => {
    const before = await db.uploadAsset.count();
    await assert.rejects(saveAccountUpload(b.id, new File([png], 'mismatch.jpg', { type: 'image/jpeg' })), /格式不符/);
    await assert.rejects(saveAccountUpload(b.id, new File(['<svg/>'], 'script.svg', { type: 'image/svg+xml' })), /仅支持/);
    assert.equal(await db.uploadAsset.count(), before);
  });
  await t.test('concurrent closure claims one transaction and records one receipt without changing balance', async () => {
    const c = await db.user.create({ data: { username: 'closing-concurrent', email: 'concurrent@example.invalid', passwordHash: await bcrypt.hash(password, 10), coins: 5 } });
    const cToken = await signToken({ userId: c.id, email: c.email });
    const responses = await Promise.all([close(request(cToken, body)), close(request(cToken, body))]);
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert(responses.every(response => [200, 401, 409].includes(response.status)), responses.map(response => response.status).join(','));
    assert.equal(await db.accountClosure.count({ where: { userId: c.id } }), 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: c.id } })).coins, 5);
  });
});
