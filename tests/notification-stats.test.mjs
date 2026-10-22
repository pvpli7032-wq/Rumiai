import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 后台通知统计（V3 第 17 章）。
 *
 * 覆盖：按 type 聚合、未读/已读拆分、时间范围过滤、登记类型 0 条也出行、
 * 未知历史类型按原值显示，以及路由的 401/403/400。
 */

const file = `notification-stats-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {readNotificationStats} = await import('../src/lib/notifications/stats.ts');
const {GET: statsRoute} = await import('../src/app/api/admin/notifications/stats/route.ts');

const [owner, reader, nobody] = await Promise.all([
  db.user.create({data: {username: 'stats_owner', email: 'stats-owner@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'stats_reader', email: 'stats-reader@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'stats_nobody', email: 'stats-nobody@example.invalid', passwordHash: 'synthetic-only'}}),
]);
await bootstrapOwner(owner.email);
// reader 拿到 operations.read，nobody 不给任何角色。
const opsRole = await saveRole(owner.id, {name: '通知统计只读', permissions: ['operations.read'], reason: '通知统计只读验收'});
await saveOperator(owner.id, {userId: reader.id, enabled: true, version: 0, roleIds: [opsRole.id], reason: '通知统计只读验收'});

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

const DAY = 86_400_000;
const NOW = new Date('2026-10-22T12:00:00.000Z');
/** 直接落表：统计只看 notifications 表，不需要走生产者链路。 */
const row = (type, daysAgo, read) => db.notification.create({data: {
  userId: owner.id, type, title: type + ' 标题',
  readAt: read ? new Date(NOW.getTime() - daysAgo * DAY + 60_000) : null,
  createdAt: new Date(NOW.getTime() - daysAgo * DAY),
}});

test('按 type 聚合，未读与已读拆开计数', async () => {
  await row('REVIEW_RESULT', 1, false);
  await row('REVIEW_RESULT', 1, true);
  await row('REVIEW_RESULT', 2, true);
  await row('REPLY', 1, false);
  await row('REPLY', 3, false);

  const report = await db.$transaction(tx => readNotificationStats(tx, new Date(NOW.getTime() - 7 * DAY), NOW, 7));
  const byType = Object.fromEntries(report.rows.map(entry => [entry.type, entry]));

  assert.deepEqual({sent: byType.REVIEW_RESULT.sent, unread: byType.REVIEW_RESULT.unread, read: byType.REVIEW_RESULT.read}, {sent: 3, unread: 1, read: 2});
  assert.equal(byType.REVIEW_RESULT.label, '审核结果');
  assert.equal(byType.REVIEW_RESULT.readRate, 2 / 3);
  assert.deepEqual({sent: byType.REPLY.sent, unread: byType.REPLY.unread, read: byType.REPLY.read}, {sent: 2, unread: 2, read: 0});
  assert.equal(byType.REPLY.label, '回复提醒');
  assert.equal(byType.REPLY.readRate, 0);

  // 登记类型 0 条也出行：这是看出某个生产者停摆的唯一位置。
  assert.deepEqual({sent: byType.COIN_RECEIVED.sent, rate: byType.COIN_RECEIVED.readRate}, {sent: 0, rate: null});
  assert.equal(byType.ACTIVITY_RESULT.sent, 0);

  assert.deepEqual(report.totals, {sent: 5, unread: 3, read: 2, readRate: 2 / 5});
  assert.equal(report.days, 7);
});

test('时间范围过滤：区间外的通知不进统计', async () => {
  // 30 天窗口能看到 3 天前那条 REPLY，7 天窗口看不到 20 天前的新行。
  await row('ACTIVITY_RESULT', 20, false);

  const week = await db.$transaction(tx => readNotificationStats(tx, new Date(NOW.getTime() - 7 * DAY), NOW, 7));
  assert.equal(week.rows.find(entry => entry.type === 'ACTIVITY_RESULT').sent, 0);

  const month = await db.$transaction(tx => readNotificationStats(tx, new Date(NOW.getTime() - 30 * DAY), NOW, 30));
  assert.equal(month.rows.find(entry => entry.type === 'ACTIVITY_RESULT').sent, 1);
  assert.equal(month.totals.sent, 6);
  // 区间两端都含：正好落在 since 上的一条要算进来。
  const edge = await db.$transaction(tx => readNotificationStats(tx, new Date(NOW.getTime() - 20 * DAY), NOW, 20));
  assert.equal(edge.rows.find(entry => entry.type === 'ACTIVITY_RESULT').sent, 1);
});

test('未知历史类型按原始值显示，不硬编假名字', async () => {
  await row('LEGACY_BROADCAST', 1, true);
  const report = await db.$transaction(tx => readNotificationStats(tx, new Date(NOW.getTime() - 7 * DAY), NOW, 7));
  const legacy = report.rows.find(entry => entry.type === 'LEGACY_BROADCAST');
  assert.equal(legacy.label, 'LEGACY_BROADCAST');
  assert.deepEqual({sent: legacy.sent, read: legacy.read}, {sent: 1, read: 1});
  // 登记类型仍排在前面。
  assert.deepEqual(report.rows.slice(0, 4).map(entry => entry.type), ['REVIEW_RESULT', 'REPLY', 'COIN_RECEIVED', 'ACTIVITY_RESULT']);
});

test('路由：未登录 401、无权限 403、天数越界 400、有权限 200', async () => {
  const tokenOf = async user => 'Bearer ' + await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion});
  const call = (authorization, days) => statsRoute(new Request('http://localhost/api/admin/notifications/stats' + (days === undefined ? '' : '?days=' + days), {
    headers: authorization ? {Authorization: authorization} : {},
  }));

  assert.equal((await call(undefined, 7)).status, 401);
  assert.equal((await call(await tokenOf(nobody), 7)).status, 403);
  assert.equal((await call(await tokenOf(reader), 0)).status, 400);
  assert.equal((await call(await tokenOf(reader), 91)).status, 400);

  const ok = await call(await tokenOf(reader), 7);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /private, no-store/);
  const body = await ok.json();
  assert.equal(body.days, 7);
  assert.equal(body.rows.length >= 4, true);
  assert.equal(typeof body.totals.sent, 'number');
});
