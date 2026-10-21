import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 玩法埋点与漏斗（V3 表 5、表 22）。
 *
 * 覆盖：白名单校验、匿名与登录两种归属、漏斗 DISTINCT 口径、
 * 分母 0 显示样本不足、prune 按天数删除。
 */

const file = `product-events-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveRole, saveOperator} = await import('../src/lib/admin/management-service.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {PRODUCT_EVENTS, recordProductEvent, pruneProductEvents} = await import('../src/lib/analytics/product-events.ts');
const {POST: reportEvent} = await import('../src/app/api/events/route.ts');
const {GET: readFunnel} = await import('../src/app/api/admin/analytics/product-funnel/route.ts');
const {MIRROR_SUBJECT_COOKIE} = await import('../src/lib/mirror/types.ts');

const owner = await db.user.create({data: {username: 'ev_owner', email: 'ev-owner@example.invalid', passwordHash: 'synthetic-only'}});
const viewer = await db.user.create({data: {username: 'ev_viewer', email: 'ev-viewer@example.invalid', passwordHash: 'synthetic-only'}});
const stranger = await db.user.create({data: {username: 'ev_stranger', email: 'ev-stranger@example.invalid', passwordHash: 'synthetic-only'}});
const tokens = new Map();
for (const user of [owner, viewer, stranger]) tokens.set(user.id, await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion}));

function request(user, body, extraHeaders = {}) {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? {Authorization: 'Bearer ' + tokens.get(user.id)} : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}
const anonymousCookie = subject => ({cookie: MIRROR_SUBJECT_COOKIE + '=' + subject});
const funnelRequest = (user, days = 7) => new Request('http://localhost/api/admin/analytics/product-funnel?days=' + days, {
  headers: user ? {Authorization: 'Bearer ' + tokens.get(user.id)} : {},
});
const eventsOf = name => db.productEvent.findMany({where: {name}, orderBy: {createdAt: 'asc'}});
// 漏斗读取要 analytics.read，先建立所有者身份；后面的用例再补只读角色。
await bootstrapOwner(owner.email);

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('白名单外的事件名被拒绝，不落库', async () => {
  for (const event of ['nope', 'MIRROR_VISITED', '', 'scene_opened']) {
    const response = await reportEvent(request(viewer, {event}));
    assert.equal(response.status, 400, event + ' 应被拒绝');
    assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'error']);
  }
  assert.equal((await reportEvent(request(viewer, {}))).status, 400);
  assert.equal(await db.productEvent.count(), 0);
});

test('properties 只接受标量且最多 10 项', async () => {
  const nested = await reportEvent(request(viewer, {event: 'mirror_visited', properties: {a: {b: 1}}}));
  assert.equal(nested.status, 400);
  const list = await reportEvent(request(viewer, {event: 'mirror_visited', properties: {a: [1, 2]}}));
  assert.equal(list.status, 400);
  const many = Object.fromEntries(Array.from({length: 11}, (_, i) => ['k' + i, i]));
  assert.equal((await reportEvent(request(viewer, {event: 'mirror_visited', properties: many}))).status, 400);
  const ok = await reportEvent(request(viewer, {event: 'mirror_visited', properties: {from: 'share', rank: 3, paid: false, note: null}}));
  assert.equal(ok.status, 204);
  const [row] = await eventsOf('mirror_visited');
  assert.deepEqual(JSON.parse(row.propertiesJson), {from: 'share', rank: 3, paid: false, note: null});
});

test('登录用户写 userId，匿名访客写服务端签发的匿名主体', async () => {
  await db.productEvent.deleteMany({});
  assert.equal((await reportEvent(request(viewer, {event: 'mirror_started', subjectKey: 'char-1'}))).status, 204);
  const [signedIn] = await eventsOf('mirror_started');
  assert.equal(signedIn.userId, viewer.id);
  assert.equal(signedIn.anonymousSubject, null, '登录用户不再写匿名标识');
  assert.equal(signedIn.subjectKey, 'char-1');

  assert.equal((await reportEvent(request(null, {event: 'mirror_share_viewed', subjectKey: 'share-9'}, anonymousCookie('anon-abc')))).status, 204);
  const [anonymous] = await eventsOf('mirror_share_viewed');
  assert.equal(anonymous.userId, null);
  assert.equal(anonymous.anonymousSubject, 'anon-abc');
  assert.equal(anonymous.subjectKey, 'share-9');

  // 既没登录也没有匿名主体：不落库，也不报错打扰页面。
  assert.equal((await reportEvent(request(null, {event: 'mirror_visited'}))).status, 204);
  assert.equal((await eventsOf('mirror_visited')).length, 0);
});

test('漏斗按 DISTINCT 归属计人，重复访问不重复计数', async () => {
  await db.productEvent.deleteMany({});
  // 同一个登录用户访问 3 次 → 1 人
  for (let i = 0; i < 3; i += 1) await reportEvent(request(viewer, {event: 'mirror_visited'}));
  // 两个匿名主体各访问 1 次 → 2 人
  await reportEvent(request(null, {event: 'mirror_visited'}, anonymousCookie('anon-1')));
  await reportEvent(request(null, {event: 'mirror_visited'}, anonymousCookie('anon-2')));
  // 开始答题：登录 1 人 + 匿名 1 人 → 2 人
  await reportEvent(request(viewer, {event: 'mirror_started'}));
  await reportEvent(request(null, {event: 'mirror_started'}, anonymousCookie('anon-1')));
  // 生成完成由服务端写（这里直接落库模拟服务端 owner 的写入）
  await recordProductEvent({event: 'mirror_completed', userId: viewer.id});
  await recordProductEvent({event: 'mirror_completed', userId: stranger.id});

  const report = await (await readFunnel(funnelRequest(owner))).json();
  const mirror = report.funnels.find(funnel => funnel.key === 'mirror');
  assert.deepEqual(mirror.steps.map(step => step.people), [3, 2, 2], '去重后的人数');
  assert.equal(mirror.steps[1].rateFromPrevious, 2 / 3);
  assert.equal(mirror.steps[2].rateFromStart, 2 / 3);
  assert.equal(mirror.overallRate, 2 / 3);
  assert.equal(mirror.steps[0].rateFromPrevious, null, '第一步没有上一步');
});

test('分母为 0 时比率是 null（界面显示样本不足，不显示 0%）', async () => {
  await db.productEvent.deleteMany({});
  const report = await (await readFunnel(funnelRequest(owner))).json();
  const invite = report.funnels.find(funnel => funnel.key === 'invite');
  assert.deepEqual(invite.steps.map(step => step.people), [0, 0, 0]);
  assert.equal(invite.overallRate, null);
  assert.equal(invite.steps[1].rateFromPrevious, null);
  assert.equal(invite.steps[2].rateFromStart, null);
  // 只有访问没有后续：后续比率为 null 而不是 0。
  await reportEvent(request(viewer, {event: 'invite_visited'}));
  const partial = (await (await readFunnel(funnelRequest(owner))).json()).funnels.find(funnel => funnel.key === 'invite');
  assert.deepEqual(partial.steps.map(step => step.people), [1, 0, 0]);
  assert.equal(partial.steps[1].rateFromPrevious, 0, '有分母时 0 就是真实的 0');
  assert.equal(partial.steps[2].rateFromPrevious, null, '上一步为 0 时没有比率');
});

test('评理四段与邀请三段共用同一套去重口径', async () => {
  await db.productEvent.deleteMany({});
  for (const event of ['dispute_visited', 'dispute_started', 'dispute_voted']) await reportEvent(request(viewer, {event}));
  await recordProductEvent({event: 'dispute_closed', userId: viewer.id, subjectKey: 'case-1'});
  await reportEvent(request(null, {event: 'dispute_visited'}, anonymousCookie('anon-x')));
  const report = await (await readFunnel(funnelRequest(owner))).json();
  const dispute = report.funnels.find(funnel => funnel.key === 'dispute');
  assert.deepEqual(dispute.steps.map(step => step.people), [2, 1, 1, 1]);
  assert.equal(dispute.steps.length, 4);
  assert.equal(report.funnels.find(funnel => funnel.key === 'invite').steps.length, 3);
  // 天数参数沿用运营分析上限
  assert.equal((await readFunnel(funnelRequest(owner, 0))).status, 400);
  assert.equal((await readFunnel(funnelRequest(owner, 91))).status, 400);
});

test('漏斗沿用 analytics.read：未登录 401，无权限 403', async () => {
  assert.equal((await readFunnel(funnelRequest(null))).status, 401);
  assert.equal((await readFunnel(funnelRequest(stranger))).status, 403);
  assert.equal((await readFunnel(funnelRequest(owner))).status, 200);
  const viewerRole = await saveRole(owner.id, {name: '分析查看验收', permissions: ['analytics.read'], reason: '合成只读分析角色'});
  await saveOperator(owner.id, {userId: viewer.id, roleIds: [viewerRole.id], enabled: true, version: (await db.adminOperator.findUnique({where: {userId: viewer.id}}))?.version ?? 0, reason: '合成分析权限'});
  assert.equal((await readFunnel(funnelRequest(viewer))).status, 200);
});

test('prune 只删保留期之前的旧事件', async () => {
  await db.productEvent.deleteMany({});
  const old = new Date(Date.now() - 200 * 86_400_000);
  const recent = new Date(Date.now() - 10 * 86_400_000);
  await db.productEvent.create({data: {name: 'mirror_visited', userId: viewer.id, createdAt: old}});
  await db.productEvent.create({data: {name: 'mirror_visited', userId: viewer.id, createdAt: recent}});
  assert.equal(await pruneProductEvents(180), 1, '默认 180 天只删更早的一条');
  assert.equal(await db.productEvent.count(), 1);
  assert.equal(await pruneProductEvents(180), 0, '重复执行不再删');
  // 非法保留天数回落到 180 天，而不是清空整表。
  await db.productEvent.create({data: {name: 'mirror_visited', userId: viewer.id, createdAt: old}});
  assert.equal(await pruneProductEvents(0), 1);
  assert.equal(await db.productEvent.count(), 1);
});

test('事件清单与标签一一对应', async () => {
  const {PRODUCT_EVENT_LABELS} = await import('../src/lib/analytics/product-events.ts');
  assert.deepEqual(Object.keys(PRODUCT_EVENT_LABELS).sort(), [...PRODUCT_EVENTS].sort());
  for (const label of Object.values(PRODUCT_EVENT_LABELS)) assert.ok(label.length > 0);
});
