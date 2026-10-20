import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createIsolatedDatabase} from '../scripts/helpers/create-isolated-db.mjs';

const file = `scene-funnel-report-${process.pid}-${Date.now()}.db`;
// 本机 schema engine 被拦（OS Error 5），按仓库约定用 node:sqlite 建隔离库。
createIsolatedDatabase(path.resolve('prisma', file));
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.PAYMENT_ADMIN_USER_IDS = ''; process.env.MODERATOR_USER_IDS = '';
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {bootstrapOwner, saveOperator} = await import('../src/lib/admin/management-service.ts');
const {readSceneFunnelReport} = await import('../src/lib/analytics/scene-funnel-report-service.ts');
const {GET} = await import('../src/app/api/admin/analytics/scene-funnel/route.ts');
const now = new Date();
const daysAgo = days => new Date(now.getTime() - days * 86400000);
const owner = await db.user.create({data: {username: 'funnel_owner_' + process.pid, email: 'funnel-owner-' + process.pid + '@example.invalid', passwordHash: 'synthetic'}});
const viewer = await db.user.create({data: {username: 'funnel_viewer_' + process.pid, email: 'funnel-viewer-' + process.pid + '@example.invalid', passwordHash: 'synthetic'}});
const alice = await db.user.create({data: {username: 'funnel_alice_' + process.pid, email: 'funnel-alice-' + process.pid + '@example.invalid', passwordHash: 'synthetic'}});
const bob = await db.user.create({data: {username: 'funnel_bob_' + process.pid, email: 'funnel-bob-' + process.pid + '@example.invalid', passwordHash: 'synthetic'}});
await bootstrapOwner(owner.email);
const role = await db.adminRole.findUniqueOrThrow({where: {code: 'ANALYTICS_VIEWER'}});
await saveOperator(owner.id, {userId: viewer.id, enabled: true, version: 0, roleIds: [role.id], reason: '隔离漏斗报表测试'});

const SCENE = 'midnight-studio-melody-ch01';
/** 幂等键 UNIQUE(user_id, conversation_id, event) 允许直接 createMany 造事实；元素为事件名或 {event, at}。 */
const seed = (userId, conversationId, events) => db.sceneFunnelEvent.createMany({data: events.map(item => {
  const {event, at} = typeof item === 'string' ? {event: item} : item;
  return {userId, conversationId, sceneId: SCENE, event, createdAt: at ?? now};
})});

const token = user => signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion});
const req = async (user, url) => new Request('http://localhost' + url, {headers: user ? {Authorization: 'Bearer ' + await token(user)} : {}});
test.after(async () => { await db.$disconnect(); });

test('permission and day bounds protect the funnel report', async () => {
  assert.equal((await GET(await req(null, '/api/admin/analytics/scene-funnel'))).status, 401);
  assert.equal((await GET(await req(alice, '/api/admin/analytics/scene-funnel'))).status, 403);
  assert.equal((await GET(await req(viewer, '/api/admin/analytics/scene-funnel?days=91'))).status, 400);
  const response = await GET(await req(viewer, '/api/admin/analytics/scene-funnel?days=7'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});

test('single full funnel, cross-user aggregation and no identifiers leak into the aggregate', async () => {
  await db.sceneFunnelEvent.deleteMany({});
  // alice：一条完整漏斗 + 一条只到达；bob：另一条完整漏斗。跨用户聚合同一漏斗。
  await seed(alice.id, 'conv-full-a', ['scene_opened', 'scene_first_message_sent', 'scene_active_end_confirmed', 'scene_close_continue_clicked']);
  await seed(alice.id, 'conv-open-only-a', ['scene_opened']);
  await seed(bob.id, 'conv-full-b', ['scene_opened', 'scene_first_message_sent', 'scene_active_end_confirmed', 'scene_close_continue_clicked']);
  const report = await readSceneFunnelReport(viewer.id, 7);
  assert.deepEqual(report.events, {opened: 3, firstSent: 2, activeEndConfirmed: 2, continueClicked: 2});
  // 首条消息率 2/3、主动结束率 2/3（两口径一致）、继续点击率 1。
  assert.equal(report.rates.firstMessageRate, 2 / 3);
  assert.equal(report.rates.activeEndRate, 2 / 3);
  assert.equal(report.rates.activeEndRateAfterFirstMessage, 1);
  assert.equal(report.rates.continueClickRate, 1);
  // 聚合结果不携带任何用户或会话标识。
  const serialized = JSON.stringify(report);
  for (const secret of [alice.id, bob.id, 'conv-full-a', 'conv-open-only-a', 'conv-full-b', alice.email, bob.email]) assert.equal(serialized.includes(secret), false);
});

test('window boundary: only the opened timestamp anchors a conversation; later nodes count regardless of their own timestamps', async () => {
  await db.sceneFunnelEvent.deleteMany({});
  // 窗口外开场：即使结束确认发生在窗口内也不进漏斗（锚定分母在窗口外）。
  await seed(alice.id, 'conv-stale', [
    {event: 'scene_opened', at: daysAgo(40)},
    {event: 'scene_first_message_sent', at: now},
    {event: 'scene_active_end_confirmed', at: now},
  ]);
  // 窗口内开场、首条消息时间戳在窗口外（跨窗口完成）：仍计入锚定漏斗。
  await seed(alice.id, 'conv-edge', [
    {event: 'scene_opened', at: now},
    {event: 'scene_first_message_sent', at: daysAgo(40)},
  ]);
  const report = await readSceneFunnelReport(viewer.id, 7);
  assert.deepEqual(report.events, {opened: 1, firstSent: 1, activeEndConfirmed: 0, continueClicked: 0});
  assert.equal(report.rates.firstMessageRate, 1);
  // 窗口内开场 1 条、结束确认 0 条：主动结束率是 0%，不是样本不足；继续点击率分母为 0 才是样本不足。
  assert.equal(report.rates.activeEndRate, 0);
  assert.equal(report.rates.activeEndRateAfterFirstMessage, 0);
  assert.equal(report.rates.continueClickRate, null);
});

test('empty data reads as sample-insufficient, not zero percent', async () => {
  await db.sceneFunnelEvent.deleteMany({});
  const report = await readSceneFunnelReport(viewer.id, 7);
  assert.deepEqual(report.events, {opened: 0, firstSent: 0, activeEndConfirmed: 0, continueClicked: 0});
  assert.equal(report.rates.firstMessageRate, null);
  assert.equal(report.rates.activeEndRate, null);
  assert.equal(report.rates.activeEndRateAfterFirstMessage, null);
  assert.equal(report.rates.continueClickRate, null);
  await assert.rejects(readSceneFunnelReport(viewer.id, 0), error => error.status === 400);
  await assert.rejects(readSceneFunnelReport(viewer.id, 91), error => error.status === 400);
});
