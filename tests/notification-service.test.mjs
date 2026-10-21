import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 站内通知（V3 第 26 章）：一套表、四类事件、顶栏抽屉。
 * 覆盖：未读计数、标记已读、目标对象跳转字段、同事件不重复通知。
 */

const file = `notification-service-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  notificationId,
  notifyActivityResult,
  notifyCoinsReceived,
  notifyReply,
  notifyReviewResult,
} = await import('../src/lib/notifications/service.ts');
const {replyExcerpt} = await import('../src/lib/notifications/reply-excerpt.ts');
const {GET, POST} = await import('../src/app/api/me/notifications/route.ts');
const {PATCH} = await import('../src/app/api/me/notifications/[id]/route.ts');
const {signToken} = await import('../src/lib/auth.ts');

const [owner, stranger] = await Promise.all([
  db.user.create({data: {username: 'notify-owner', email: 'owner@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'notify-stranger', email: 'stranger@example.invalid', passwordHash: 'synthetic-only'}}),
]);

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

async function request(user, method = 'GET', body, suffix = '') {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (user) headers.Authorization = `Bearer ${await signToken({userId: user.id, email: user.email})}`;
  return new Request('http://localhost/api/me/notifications' + suffix, {
    method,
    headers,
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
}

const unreadOf = userId => db.notification.count({where: {userId, readAt: null}});

test('目标对象跳转字段：四类目标各有唯一路径，缺目标或未知类型返回 null', () => {
  assert.equal(notificationHref('CHARACTER', 'char-1'), '/zh/character/char-1');
  assert.equal(notificationHref('CONVERSATION', 'conv 1'), '/chat?conversation=conv%201');
  assert.equal(notificationHref('COIN_LEDGER', 'txn-1'), '/shop/ledger');
  assert.equal(notificationHref('ACTIVITY', 'act-1'), '/leaderboard');
  assert.equal(notificationHref('CHARACTER', null), null);
  assert.equal(notificationHref(null, 'char-1'), null);
  assert.equal(notificationHref('UNKNOWN_TARGET', 'x'), null);
});

test('同事件不重复通知：重放命中同一行，事件键不同才是新通知', async () => {
  const first = await notifyReviewResult({
    userId: owner.id, reviewId: 'review-1', characterId: 'char-1', characterName: '测试角色', approved: true,
  });
  assert.equal(first.created, true);
  const replay = await notifyReviewResult({
    userId: owner.id, reviewId: 'review-1', characterId: 'char-1', characterName: '测试角色', approved: true,
  });
  assert.deepEqual(replay, {id: first.id, created: false});
  assert.equal(await db.notification.count({where: {userId: owner.id}}), 1);

  const next = await notifyReviewResult({
    userId: owner.id, reviewId: 'review-2', characterId: 'char-1', characterName: '测试角色', approved: false, reason: '人设过于单薄',
  });
  assert.notEqual(next.id, first.id);
  assert.equal(await db.notification.count({where: {userId: owner.id}}), 2);
  // 通知 id 由「用户 + 类型 + 事件键」决定：重放同一个键必然算出同一个 id。
  assert.equal(
    notificationId(owner.id, 'REVIEW_RESULT', 'review-1'),
    notificationId(owner.id, 'REVIEW_RESULT', 'review-1'),
  );
  assert.notEqual(notificationId(stranger.id, 'REVIEW_RESULT', 'review-1'), notificationId(owner.id, 'REVIEW_RESULT', 'review-1'));
});

test('回复摘要压成一行并截断，抽屉里只占两行', () => {
  assert.equal(replyExcerpt('  第一行\n\n第二行  '), '第一行 第二行');
  assert.equal(replyExcerpt('长'.repeat(100)).length, 81);
  assert.ok(replyExcerpt('长'.repeat(100)).endsWith('…'));
});

test('未读计数：列表与计数同源，已读后减少，全部已读归零', async () => {
  const page = await listNotifications(owner.id);
  assert.equal(page.unreadCount, 2);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].title, '角色《测试角色》未通过审核');
  assert.equal(page.items[0].body, '人设过于单薄');
  assert.equal(page.items[0].targetType, 'CHARACTER');
  assert.equal(page.items[0].targetId, 'char-1');
  assert.equal(page.items[0].href, '/zh/character/char-1');
  assert.equal(page.items[0].readAt, null);
  assert.deepEqual(await listNotifications(stranger.id), {items: [], unreadCount: 0, nextCursor: null});

  const read = await markNotificationRead(owner.id, page.items[0].id);
  assert.equal(read.unreadCount, 1);
  assert.equal(await unreadOf(owner.id), 1);
  const afterRead = await listNotifications(owner.id);
  assert.equal(afterRead.unreadCount, 1);
  assert.ok(afterRead.items.find(item => item.id === page.items[0].id).readAt);

  assert.equal((await markAllNotificationsRead(owner.id)).unreadCount, 0);
  assert.equal((await listNotifications(owner.id)).unreadCount, 0);
});

test('标记已读幂等，且不会替别人标记', async () => {
  const row = await db.notification.findFirst({where: {userId: owner.id}, orderBy: {createdAt: 'desc'}});
  const firstRead = (await listNotifications(owner.id)).items.find(item => item.id === row.id).readAt;
  assert.ok(firstRead);
  await markNotificationRead(owner.id, row.id);
  const secondRead = (await listNotifications(owner.id)).items.find(item => item.id === row.id).readAt;
  assert.equal(secondRead, firstRead, '重复标记保留首次已读时间');

  await assert.rejects(() => markNotificationRead(stranger.id, row.id), error => error.status === 404);
  assert.equal((await listNotifications(stranger.id)).unreadCount, 0);

  const reply = await notifyReply({userId: owner.id, messageId: 'msg-1', conversationId: 'conv-1', characterName: '阿岚', excerpt: '晚上好。'});
  assert.equal(reply.created, true);
  const item = (await listNotifications(owner.id)).items.find(entry => entry.id === reply.id);
  assert.equal(item.type, 'REPLY');
  assert.equal(item.title, '阿岚 回复了你');
  assert.equal(item.href, '/chat?conversation=conv-1');
  assert.equal(item.readAt, null);
});

test('到账与活动结果各走自己的目标对象，历史未知类型不丢', async () => {
  const coin = await notifyCoinsReceived({userId: owner.id, transactionId: 'txn-1', amount: 120, reason: '充值到账'});
  const activity = await notifyActivityResult({userId: owner.id, activityId: 'act-1', activityName: '夏日祭', summary: '你获得第 3 名'});
  const items = (await listNotifications(owner.id)).items;
  const coinItem = items.find(entry => entry.id === coin.id);
  const activityItem = items.find(entry => entry.id === activity.id);
  assert.equal(coinItem.title, '金币到账 +120');
  assert.equal(coinItem.href, '/shop/ledger');
  assert.equal(activityItem.href, '/leaderboard');
  assert.equal(activityItem.title, '夏日祭结果公布');

  // 历史行里的未知类型照常读出，只是没有跳转地址。
  const legacy = await db.notification.create({
    data: {userId: owner.id, type: 'LEGACY_TYPE', title: '旧通知', targetType: 'OLD_TARGET', targetId: 'x'},
  });
  const legacyItem = (await listNotifications(owner.id)).items.find(entry => entry.id === legacy.id);
  assert.equal(legacyItem.href, null);
  assert.equal(legacyItem.type, 'LEGACY_TYPE');
});

test('HTTP：未登录 401，别人的通知 404，列表与已读计数走同一个接口', async () => {
  assert.equal((await GET(await request(null))).status, 401);
  assert.equal((await POST(await request(null))).status, 401);
  const listing = await GET(await request(owner));
  assert.equal(listing.status, 200);
  assert.match(listing.headers.get('cache-control'), /private, no-store/);
  const page = await listing.json();
  // 接口的未读数必须与库里未读行数逐条对得上，红点和列表同一个来源。
  const expectedUnread = await unreadOf(owner.id);
  assert.equal(page.unreadCount, expectedUnread);
  // 列表含已读行：前几步的标记已读不会把行从列表里抹掉，红点却要跟着减。
  assert.equal(page.items.length, await db.notification.count({where: {userId: owner.id}}));
  assert.equal(page.items.filter(item => item.readAt === null).length, expectedUnread);
  const characterRows = page.items.filter(item => item.href?.startsWith('/zh/character/'));
  assert.equal(characterRows.length, 2, '两条审核结果都能跳回角色');

  // 先标一条未读，否则「减一」在表里已经是已读也看不出来。
  const target = page.items.find(item => item.readAt === null).id;
  assert.equal((await PATCH(await request(stranger, 'PATCH'), {params: Promise.resolve({id: target})})).status, 404);
  assert.equal((await PATCH(await request(owner, 'PATCH'), {params: Promise.resolve({id: 'not-a-real-id'})})).status, 404);

  const marked = await PATCH(await request(owner, 'PATCH'), {params: Promise.resolve({id: target})});
  assert.equal(marked.status, 200);
  assert.equal((await marked.json()).unreadCount, expectedUnread - 1);

  const all = await POST(await request(owner, 'POST'));
  assert.equal(all.status, 200);
  assert.equal((await all.json()).unreadCount, 0);
  assert.equal((await (await GET(await request(owner))).json()).unreadCount, 0);
});

test('分页游标翻页，非法游标回到第一页', async () => {
  for (let index = 0; index < 25; index += 1) {
    await createNotification({
      userId: stranger.id, type: 'ACTIVITY_RESULT', eventKey: 'page-' + index,
      title: '活动 ' + index, targetType: 'ACTIVITY', targetId: 'act-' + index,
    });
  }
  const first = await listNotifications(stranger.id);
  assert.equal(first.items.length, 20);
  assert.equal(first.unreadCount, 25);
  assert.ok(first.nextCursor);
  const second = await listNotifications(stranger.id, {cursor: first.nextCursor});
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(second.unreadCount, 25);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 25);

  const fallback = await listNotifications(stranger.id, {cursor: 'bad cursor!!'});
  assert.deepEqual(fallback.items.map(item => item.id), first.items.map(item => item.id));
});

test('缺用户、缺事件键或空标题直接拒绝，不落半条脏数据', async () => {
  const before = await db.notification.count();
  for (const input of [
    {userId: '', type: 'REPLY', eventKey: 'k', title: '标题'},
    {userId: owner.id, type: 'REPLY', eventKey: '', title: '标题'},
    {userId: owner.id, type: 'REPLY', eventKey: 'k', title: '   '},
  ]) {
    await assert.rejects(() => createNotification(input), error => error.status === 400);
  }
  assert.equal(await db.notification.count(), before);
});
