import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `character-review-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`; process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', 'character-review', file, 'uploads');
const env = {...process.env}; delete env.RUST_LOG;
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(result.status, 0, result.stdout + result.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {reviewCharacter, reviewCharacters, readCharacterReviewQueue} = await import('../src/lib/characters/review-service.ts');
const {POST: batchRoute} = await import('../src/app/api/moderation/characters/batch/route.ts');
const {GET: publicRoles} = await import('../src/app/api/characters/route.ts');
const {signToken} = await import('../src/lib/auth.ts');
const users = [];
for (const username of ['author', 'moderator', 'ordinary', 'viewer']) users.push(await db.user.create({data: {username, email: `${username}@example.invalid`, passwordHash: 'synthetic-only'}}));
const [author, moderator, ordinary, viewer] = users;
process.env.MODERATOR_USER_IDS = moderator.id; process.env.PAYMENT_ADMIN_USER_IDS = '';
await db.adminOperator.create({data: {userId: viewer.id, assignments: {create: {role: {create: {code: 'CUSTOM_REVIEW_VIEWER', name: '审核只读', permissions: {create: {permission: 'moderation.read'}}}}}}}});
const fixture = (name, overrides = {}) => db.character.create({data: {creatorId: author.id, name, personality: 'PRIVATE_PERSONA', background: '合成背景', publicationRequested: true, reviewStatus: 'PENDING', copyrightStatement: '合成原创验收', ...overrides}});
const target = role => ({id: role.id, updatedAt: role.updatedAt.toISOString()});
const body = (roles, status = 'APPROVED', reason = '') => ({items: roles.map(target), status, reason});
const rejected = (fn, status) => assert.rejects(fn, error => error.status === status);
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('single review retains response compatibility and links publication to the public list', async () => {
  const role = await fixture('single'); assert.deepEqual(await reviewCharacter(moderator.id, role.id, {status: 'APPROVED', reason: '', updatedAt: role.updatedAt.toISOString()}), {success: true});
  const published = await db.character.findUnique({where: {id: role.id}}); assert(published.isPublic); assert(published.updatedAt > role.updatedAt);
  const list = await (await publicRoles(new Request('http://localhost/api/characters'))).json(); assert(list.some(item => item.id === role.id));
  await reviewCharacter(moderator.id, role.id, {status: 'REJECTED', reason: '版权复核下架', updatedAt: published.updatedAt.toISOString()});
  const removed = await (await publicRoles(new Request('http://localhost/api/characters'))).json(); assert(!removed.some(item => item.id === role.id));
});
test('batch review atomically publishes selected roles and records sanitized audits', async () => {
  const roles = await Promise.all(['batch_a', 'batch_b'].map(name => fixture(name)));
  const result = await reviewCharacters(moderator.id, body(roles)); assert.equal(result.items.length, 2);
  assert.equal(await db.character.count({where: {id: {in: roles.map(role => role.id)}, isPublic: true}}), 2);
  const audit = await db.adminAuditLog.findMany({where: {targetId: {in: roles.map(role => role.id)}}}); assert.equal(audit.length, 2); assert(!JSON.stringify(audit).includes('PRIVATE_PERSONA'));
});
test('one missing copyright rolls back every publication and audit in the batch', async () => {
  const roles = [await fixture('valid_copyright'), await fixture('missing_copyright', {copyrightStatement: ''})];
  await rejected(() => reviewCharacters(moderator.id, body(roles)), 400);
  assert.equal(await db.character.count({where: {id: {in: roles.map(role => role.id)}, isPublic: true}}), 0); assert.equal(await db.adminAuditLog.count({where: {targetId: {in: roles.map(role => role.id)}}}), 0);
});
test('author edit or withdrawal invalidates the entire selected snapshot', async () => {
  const roles = [await fixture('current'), await fixture('changed')];
  await db.character.update({where: {id: roles[1].id}, data: {name: 'changed_again', updatedAt: new Date(roles[1].updatedAt.getTime() + 1)}});
  await rejected(() => reviewCharacters(moderator.id, body(roles)), 409); assert.equal((await db.character.findUnique({where: {id: roles[0].id}})).isPublic, false);
  const withdrawn = await fixture('withdrawn', {publicationRequested: false, reviewStatus: 'DRAFT'});
  await rejected(() => reviewCharacters(moderator.id, body([withdrawn])), 409);
});
test('concurrent review of the same version succeeds once with one audit', async () => {
  const role = await fixture('concurrent'); const outcomes = await Promise.allSettled([reviewCharacters(moderator.id, body([role])), reviewCharacters(moderator.id, body([role], 'REJECTED', '并发退回'))]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(await db.adminAuditLog.count({where: {targetId: role.id}}), 1);
});
test('batch validates selection limits, duplicates, rejection reasons and transport shape', async () => {
  const role = await fixture('validation');
  for (const input of [null, [], body([]), body([role, role]), {...body([role]), items: Array.from({length: 26}, () => target(role))}, body([role], 'REJECTED', ''), {...body([role]), reason: 'x'.repeat(1001)}, {...body([role]), status: 'BROKEN'}, {status: 'APPROVED', reason: '', items: [{id: role.id, updatedAt: 'invalid'}]}]) await rejected(() => reviewCharacters(moderator.id, input), 400);
  assert.equal((await db.character.findUnique({where: {id: role.id}})).reviewStatus, 'PENDING');
});
test('ordinary, read-only and suspended users cannot review even through direct service calls', async () => {
  const role = await fixture('authority');
  await rejected(() => reviewCharacters(ordinary.id, body([role])), 403); await rejected(() => reviewCharacters(viewer.id, body([role])), 403);
  const token = await signToken({userId: viewer.id, email: viewer.email});
  const response = await batchRoute(new Request('http://localhost/api/moderation/characters/batch', {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body([role]))})); assert.equal(response.status, 403);
  await db.user.update({where: {id: moderator.id}, data: {suspendedAt: new Date()}}); await rejected(() => reviewCharacters(moderator.id, body([role])), 403);
});

test('reported role counts are numbers in reviewer and author responses', async () => {
  const role = await fixture('reported_count');
  await db.report.create({data: {reporterId: ordinary.id, targetType: 'CHARACTER', targetId: role.id, category: 'OTHER', details: '合成举报'}});
  const queue = await readCharacterReviewQueue(viewer.id); assert.equal(queue.find(item => item.id === role.id).openReportCount, 1);
  const token = await signToken({userId: author.id, email: author.email});
  const mine = await (await publicRoles(new Request('http://localhost/api/characters?scope=mine', {headers: {Authorization: `Bearer ${token}`}}))).json();
  assert.equal(mine.find(item => item.id === role.id).openReportCount, 1);
});
