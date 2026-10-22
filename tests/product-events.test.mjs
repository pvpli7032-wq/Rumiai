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
  // 五环都在；后两环这批人没走过，人数就是 0。
  assert.deepEqual(mirror.steps.map(step => step.people), [3, 2, 2, 0, 0], '去重后的人数');
  assert.equal(mirror.steps[1].rateFromPrevious, 2 / 3);
  assert.equal(mirror.steps[2].rateFromStart, 2 / 3);
  // 端到端是「最后一环 / 第一环」。五环补齐后最后一环是转去聊天，这批人一次都没走，
  // 所以端到端是 0 而不是 2/3 —— 生成完成的转化看第三环的 rateFromStart，不看 overallRate。
  assert.equal(mirror.steps[2].rateFromPrevious, 1, '上一环到完成没有流失');
  assert.equal(mirror.overallRate, 0);
  assert.equal(mirror.steps[3].rateFromPrevious, 0, '完成生成的人里没人打开分享页');
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

test('Mirror 漏斗五环齐全，分享访问与转去聊天固定除以生成完成人数', async () => {
  await db.productEvent.deleteMany({});
  // 6 人访问 → 4 人开始 → 2 人完成；其中 1 人转过分享页，3 人（含没完成生成的匿名访客）转去聊天。
  // 直接用 createMany 造事实：这里验的是漏斗口径，不是埋点写入路径。
  // userId 有外键，所以先建一批真账号，再按 userId 写事件。
  const makeUsers = async (prefix, count) => {
    const rows = [];
    for (let i = 0; i < count; i += 1) rows.push(await db.user.create({data: {username: `${prefix}_${i}`, email: `${prefix}${i}@example.invalid`, passwordHash: 'synthetic-only'}}));
    return rows.map(row => row.id);
  };
  const people = (event, ids, extra = {}) => db.productEvent.createMany({data: ids.map(id => ({name: event, ...(id.startsWith('a:') ? {anonymousSubject: id.slice(2)} : {userId: id}), ...extra}))});
  await people('mirror_visited', await makeUsers('mv', 6));
  await people('mirror_started', await makeUsers('ms', 4));
  await people('mirror_completed', await makeUsers('mc', 2));
  await people('mirror_share_viewed', ['a:share-anon']);
  await people('mirror_to_chat', await makeUsers('mt', 3));

  const report = await (await readFunnel(funnelRequest(owner))).json();
  const mirror = report.funnels.find(funnel => funnel.key === 'mirror');
  assert.deepEqual(mirror.steps.map(step => step.event), ['mirror_visited', 'mirror_started', 'mirror_completed', 'mirror_share_viewed', 'mirror_to_chat'], '表 22 的五个环节都要在漏斗里');
  assert.deepEqual(mirror.steps.map(step => step.people), [6, 4, 2, 1, 3]);
  assert.equal(mirror.steps[3].rateFromPrevious, 1 / 2, '分享访问除以生成完成人数，不除以上一步');
  assert.equal(mirror.steps[4].rateFromPrevious, 3 / 2, '转去聊天的分母同样是生成完成人数');
  assert.equal(mirror.steps[4].rateFromStart, 3 / 6, '整体转化仍以第一环为分母');
  assert.equal(mirror.overallRate, 3 / 6);
});

test('邀请后两环有真实生产者：落地访问与首次聊天都写得进去，且不重复膨胀', async () => {
  await db.productEvent.deleteMany({});
  const {recordInviteVisit, ensureInviteCode, grantInviteRewardIfDue} = await import('../src/lib/growth/invite-service.ts');
  const {saveChanges} = await import('../src/lib/settings/service.ts');
  // 邀请开关要打开：关闭时服务不生成归属，也不记这两个事件。
  await saveChanges({changes: [{key: 'growth.inviteEnabled', value: true}, {key: 'growth.inviteRewardCoins', value: 0}], expectedVersions: {}, operatorId: owner.id});
  const inviter = await db.user.create({data: {username: 'inv_host', email: 'inv-host@example.invalid', passwordHash: 'synthetic-only'}});
  const code = await ensureInviteCode(inviter.id);

  // 访问：同一访客对同一邀请人只落一条，换个人再访问才加一条。
  assert.equal(await recordInviteVisit({inviteCode: code, userId: null, anonymousSubject: 'anon-visitor'}), true);
  assert.equal(await recordInviteVisit({inviteCode: code, userId: null, anonymousSubject: 'anon-visitor'}), false, '同一访客重复进入不再写');
  assert.equal(await recordInviteVisit({inviteCode: code, userId: viewer.id, anonymousSubject: null}), true);
  assert.equal(await recordInviteVisit({inviteCode: 'ZZZZZZZZ', userId: null, anonymousSubject: 'anon-2'}), false, '无效邀请码不写');
  assert.equal(await recordInviteVisit({inviteCode: code, userId: null, anonymousSubject: null}), false, '没有可归属的身份不写');
  const visits = await eventsOf('invite_visited');
  assert.equal(visits.length, 2);
  assert.ok(visits.every(row => row.subjectKey === inviter.id), 'subjectKey 记邀请人');

  // 首次聊天：奖励币设成 0 也要记——这段邀请关系确实走到了首次聊天。
  const invited = await db.user.create({data: {username: 'inv_invited', email: 'inv-invited@example.invalid', passwordHash: 'synthetic-only', invitedByUserId: inviter.id}});
  assert.equal(await grantInviteRewardIfDue(invited.id), false, '奖励币为 0 时不发币');
  assert.equal((await eventsOf('invite_first_chat')).length, 1, '不发币但漏斗最后一环照记');
  await grantInviteRewardIfDue(invited.id);
  assert.equal((await eventsOf('invite_first_chat')).length, 1, '同一个人一辈子只记一条');

  // 没有邀请归属的账号不写这一环，也不报错。
  const lonely = await db.user.create({data: {username: 'inv_lonely', email: 'inv-lonely@example.invalid', passwordHash: 'synthetic-only'}});
  assert.equal(await grantInviteRewardIfDue(lonely.id), false);
  assert.equal((await eventsOf('invite_first_chat')).length, 1);

  const funnel = (await (await readFunnel(funnelRequest(owner))).json()).funnels.find(item => item.key === 'invite');
  assert.deepEqual(funnel.steps.map(step => step.people), [2, 0, 1], '后两环不再恒为 0');
});
