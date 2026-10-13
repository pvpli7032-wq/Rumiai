import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `circle-service-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {createCircle, listCircles, changeCircleSubscription} = await import('../src/lib/circles/service.ts');
const {GET, POST} = await import('../src/app/api/circles/route.ts');
const {PUT} = await import('../src/app/api/circles/[id]/subscription/route.ts');
const {signToken} = await import('../src/lib/auth.ts');
const users = [];
for (const username of ['author', 'member', 'banned', 'suspended', 'retired', 'quota']) users.push(await db.user.create({data: {username, email: `${username}@example.invalid`, passwordHash: 'synthetic-only'}}));
const [author, member, banned, suspended, retired, quota] = users;
const world = await db.universe.create({data: {name: '公开世界', description: '合成世界'}});
const privateWorld = await db.universe.create({data: {name: 'PRIVATE_WORLD_SECRET', description: 'private', isPublic: false}});
const input = {name: '原创圈子', description: '合成介绍', tags: '原创，治愈,原创', universeId: world.id};
let circle;
const deny = (fn, status) => assert.rejects(fn, error => error.status === status);
async function request(user, method = 'GET', body, suffix = '') {
  const headers = {'Content-Type': 'application/json'};
  if (user) headers.Authorization = `Bearer ${await signToken({userId: user.id, email: user.email})}`;
  return new Request('http://localhost/api/circles' + suffix, {method, headers, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
}
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('creation owns identity, public universe validation and private projections', async () => {
  circle = await createCircle(author.id, {...input, ownerId: member.id, status: 'HIDDEN'});
  assert.equal(circle.owner.id, author.id); assert.equal(circle.tags, '原创,治愈'); assert.equal(circle.subscribed, false); assert.equal(circle.subscriberCount, 0);
  await deny(() => createCircle(author.id, {...input, universeId: privateWorld.id}), 400);
  assert(!JSON.stringify(await listCircles(null, {})).includes(author.email));
  await db.universe.update({where: {id: world.id}, data: {isPublic: false}});
  assert.equal((await listCircles(null, {}))[0].universe, null);
  assert.deepEqual(await listCircles(member.id, {scope: 'mine'}), []);
  assert.equal((await listCircles(author.id, {scope: 'mine', search: '治愈'}))[0].id, circle.id);
});
test('concurrent subscriptions are idempotent and transport cannot forge the member', async () => {
  const results = await Promise.all(Array.from({length: 4}, () => changeCircleSubscription(member.id, circle.id, true)));
  assert(results.every(result => result.subscribed && result.subscriberCount === 1));
  assert.equal(await db.circleMember.count({where: {circleId: circle.id}}), 1);
  const response = await PUT(await request(member, 'PUT', {userId: author.id}), {params: Promise.resolve({id: circle.id})});
  assert.equal(response.status, 200); assert.equal(await db.circleMember.count({where: {circleId: circle.id}}), 1);
  assert.deepEqual(await listCircles(author.id, {scope: 'subscribed'}), []);
  assert.equal((await listCircles(member.id, {scope: 'subscribed'}))[0].subscribed, true);
  for (let i = 0; i < 2; i++) assert.deepEqual(await changeCircleSubscription(member.id, circle.id, false), {subscribed: false, subscriberCount: 0});
});
test('hidden parent circle prevents membership writes and public discovery', async () => {
  await db.circle.update({where: {id: circle.id}, data: {status: 'HIDDEN'}});
  await deny(() => changeCircleSubscription(member.id, circle.id, true), 404);
  assert.deepEqual(await listCircles(null, {}), []);
  await db.circle.update({where: {id: circle.id}, data: {status: 'ACTIVE'}});
});
test('domain calls recheck ban, suspension and closure rather than trusting a prior authentication', async () => {
  await db.user.update({where: {id: banned.id}, data: {communityBannedAt: new Date(), communityBanReason: '合成禁言理由'}});
  await assert.rejects(() => createCircle(banned.id, {...input, universeId: null}), error => error.status === 403 && error.reason === '合成禁言理由');
  assert.equal((await changeCircleSubscription(banned.id, circle.id, false)).subscribed, false);
  await db.user.update({where: {id: suspended.id}, data: {suspendedAt: new Date()}});
  await db.user.update({where: {id: retired.id}, data: {deletedAt: new Date()}});
  for (const user of [suspended, retired]) {
    await deny(() => createCircle(user.id, {...input, universeId: null}), 401);
    await deny(() => changeCircleSubscription(user.id, circle.id, true), 401);
  }
});
test('HTTP preserves authentication, input errors, private caching and rate-limit headers', async () => {
  assert.equal((await POST(await request(null, 'POST', input))).status, 401);
  assert.equal((await GET(await request(null, 'GET', undefined, '?scope=mine'))).status, 401);
  assert.equal((await GET(await request(null, 'GET', undefined, '?scope=bad'))).status, 400);
  assert.equal((await POST(await request(author, 'POST', []))).status, 400);
  const listing = await GET(await request(null)); assert.match(listing.headers.get('cache-control'), /private, no-store/);
  for (let i = 0; i < 5; i++) assert.equal((await POST(await request(quota, 'POST', {...input, universeId: null}))).status, 201);
  const limited = await POST(await request(quota, 'POST', {...input, universeId: null}));
  assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
});
