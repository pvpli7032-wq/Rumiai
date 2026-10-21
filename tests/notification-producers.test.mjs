import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 站内通知的真实生产者（V3 §26）。
 *
 * 前一份 notification-service.test.mjs 只验证通知读写；这里验证四类事件真的由业务动作产生：
 * 审核结果、回复提醒、到账、活动结果，以及失败容忍与幂等重放。
 */

const file = `notification-producers-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {notificationHref, notifyCoinsReceived} = await import('../src/lib/notifications/service.ts');
const {reviewCharacters} = await import('../src/lib/characters/review-service.ts');
const {createCharacterComment} = await import('../src/lib/characters/comment-service.ts');
const {simulateCoinPurchase} = await import('../src/lib/payments/purchase-service.ts');
const {createDisputeCase} = await import('../src/lib/disputes/case-service.ts');
const {closeDisputeCase} = await import('../src/lib/disputes/close-service.ts');
const {bootstrapOwner} = await import('../src/lib/admin/management-service.ts');

const [owner, replier] = await Promise.all([
  db.user.create({data: {username: 'producer-owner', email: 'producer-owner@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'producer-replier', email: 'producer-replier@example.invalid', passwordHash: 'synthetic-only'}}),
]);

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 某人的最新一条通知。 */
const latestFor = userId => db.notification.findFirst({where: {userId}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}]});

/** 造一个待审核角色：审核链路要求 publicationRequested + PENDING + 版本号。 */
const pendingCharacter = (creatorId, name) => db.character.create({data: {
  creatorId, name, personality: '安静', background: '合成背景',
  isPublic: false, reviewStatus: 'PENDING', publicationRequested: true,
  copyrightStatement: '合成测试素材',
}, select: {id: true, updatedAt: true}});

test('审核结果通知角色作者：通过无原因，驳回带原因，点进去是那个角色', async () => {
  await bootstrapOwner(owner.email);
  const approved = await pendingCharacter(owner.id, '通过的角色');
  const rejected = await pendingCharacter(owner.id, '驳回的角色');

  await reviewCharacters(owner.id, {status: 'APPROVED', reason: '', items: [{id: approved.id, updatedAt: approved.updatedAt.toISOString()}]});
  const approveNotice = await latestFor(owner.id);
  assert.equal(approveNotice.type, 'REVIEW_RESULT');
  assert.equal(approveNotice.title, '角色《通过的角色》已通过审核');
  assert.equal(notificationHref(approveNotice.targetType, approveNotice.targetId), '/zh/character/' + approved.id);

  await reviewCharacters(owner.id, {status: 'REJECTED', reason: '人设过于单薄', items: [{id: rejected.id, updatedAt: rejected.updatedAt.toISOString()}]});
  const rejectNotice = await latestFor(owner.id);
  assert.equal(rejectNotice.title, '角色《驳回的角色》未通过审核');
  assert.equal(rejectNotice.body, '人设过于单薄', '驳回必须带原因');
  assert.equal(notificationHref(rejectNotice.targetType, rejectNotice.targetId), '/zh/character/' + rejected.id);
});

test('回复提醒：回复别人的评论才通知，自己回复自己不通知', async () => {
  const character = await db.character.create({data: {
    creatorId: owner.id, name: '评论角色', personality: '健谈', background: '合成背景',
    isPublic: true, reviewStatus: 'APPROVED',
  }, select: {id: true}});
  const rootComment = await createCharacterComment(replier.id, character.id, {body: '我觉得这个角色很有意思'});
  const before = await db.notification.count({where: {userId: replier.id}});

  const reply = await createCharacterComment(owner.id, character.id, {body: '谢谢，我也这么觉得', parentId: rootComment.comment.id});
  const notice = await latestFor(replier.id);
  assert.equal(notice.type, 'REPLY');
  assert.equal(notice.title, owner.username + ' 回复了你');
  assert.equal(notice.body, '谢谢，我也这么觉得');
  assert.equal(notificationHref(notice.targetType, notice.targetId), '/zh/character/' + character.id);
  assert.equal(await db.notification.count({where: {userId: replier.id}}), before + 1);

  // 自己回复自己：不产生新通知。
  const selfBefore = await db.notification.count({where: {userId: owner.id, type: 'REPLY'}});
  await createCharacterComment(owner.id, character.id, {body: '补充一句', parentId: reply.comment.id});
  assert.equal(await db.notification.count({where: {userId: owner.id, type: 'REPLY'}}), selfBefore, '自己回复自己不通知');
});

test('到账通知：充值加币后产生一条，点进去是金币流水', async () => {
  process.env.ALLOW_SIMULATED_PURCHASES = 'true';
  const pkg = await db.coinPackage.create({data: {label: '合成套餐', coins: 100, bonus: 20, priceThb: 300, priceCnyCents: 600, isActive: true}});
  const coinsBefore = (await db.user.findUnique({where: {id: replier.id}, select: {coins: true}})).coins;
  const result = await simulateCoinPurchase(replier.id, pkg.id);
  assert.equal(result.coinsAdded, 120);
  assert.equal((await db.user.findUnique({where: {id: replier.id}, select: {coins: true}})).coins, coinsBefore + 120);

  const notice = await latestFor(replier.id);
  assert.equal(notice.type, 'COIN_RECEIVED');
  assert.equal(notice.title, '金币到账 +120');
  assert.equal(notificationHref(notice.targetType, notice.targetId), '/shop/ledger');
});

test('活动结果：评理结案后通知发起人，点进去是那条案例，重复结案不重复通知', async () => {
  // 评理要求账号注册满 24 小时：把 createdAt 往前拨。
  const author = await db.user.create({data: {username: 'dispute-author', email: 'dispute-author@example.invalid', passwordHash: 'synthetic-only', createdAt: new Date(Date.now() - 72 * 3_600_000)}});
  const character = await db.character.create({data: {
    creatorId: author.id, name: '评理角色', personality: '冷静', background: '合成背景', isPublic: true, reviewStatus: 'APPROVED',
  }, select: {id: true}});
  const conversation = await db.conversation.create({data: {userId: author.id, characterId: character.id, title: '合成会话'}});
  const messages = [];
  for (const [role, content] of [['USER', '今晚吃什么？'], ['ASSISTANT', '煮饭吧。']]) {
    messages.push(await db.message.create({data: {conversationId: conversation.id, role, content}}));
  }
  const created = await createDisputeCase(author.id, {conversationId: conversation.id, messageIds: messages.map(message => message.id), claim: '这样安排是不是太强势？'});
  const closed = await closeDisputeCase(created.caseId, {force: true, generate: async () => '两边都有道理，各退一步。'});
  assert.equal(closed.status, 'CLOSED');

  const notice = await latestFor(author.id);
  assert.equal(notice.type, 'ACTIVITY_RESULT');
  assert.equal(notice.title, '评理案例结果公布');
  assert.match(notice.body, /已结案/);
  assert.equal(notificationHref(notice.targetType, notice.targetId), '/zh/disputes/' + created.caseId);

  const again = await closeDisputeCase(created.caseId, {force: true, generate: async () => '重复结案'});
  assert.equal(again.status, 'ALREADY_CLOSED');
  assert.equal(await db.notification.count({where: {userId: author.id, type: 'ACTIVITY_RESULT'}}), 1);
});

test('同一事件重放不产生第二条通知：同一笔流水只落一条，新流水才有新通知', async () => {
  process.env.ALLOW_SIMULATED_PURCHASES = 'true';
  const before = await db.notification.count({where: {userId: replier.id, type: 'COIN_RECEIVED'}});
  const first = await notifyCoinsReceived({userId: replier.id, transactionId: 'replayed-txn', amount: 50, reason: '重复回调'});
  const replay = await notifyCoinsReceived({userId: replier.id, transactionId: 'replayed-txn', amount: 50, reason: '重复回调'});
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.id, first.id, '重放命中同一行');
  assert.equal(await db.notification.count({where: {userId: replier.id, type: 'COIN_RECEIVED'}}), before + 1);

  // 真实充值再跑一次：新流水 → 新通知，但每次充值只有一条。
  const pkg = await db.coinPackage.findFirst({where: {label: '合成套餐'}, select: {id: true}});
  await simulateCoinPurchase(replier.id, pkg.id);
  assert.equal(await db.notification.count({where: {userId: replier.id, type: 'COIN_RECEIVED'}}), before + 2);
});

test('通知写入失败时主流程仍然成功：加币照常到账，只是少一条通知', async () => {
  process.env.ALLOW_SIMULATED_PURCHASES = 'true';
  const pkg = await db.coinPackage.findFirst({where: {label: '合成套餐'}, select: {id: true}});
  const coinsBefore = (await db.user.findUnique({where: {id: owner.id}, select: {coins: true}})).coins;
  const noticesBefore = await db.notification.count({where: {userId: owner.id}});

  // 让通知写入直接抛错：模拟通知表不可用。
  const original = db.notification.create;
  db.notification.create = async () => { throw new Error('notification store unavailable'); };
  try {
    const result = await simulateCoinPurchase(owner.id, pkg.id);
    assert.equal(result.coinsAdded, 120, '充值本身必须成功');
  } finally {
    db.notification.create = original;
  }
  assert.equal((await db.user.findUnique({where: {id: owner.id}, select: {coins: true}})).coins, coinsBefore + 120, '金币必须真的到账');
  assert.equal(await db.notification.count({where: {userId: owner.id}}), noticesBefore, '通知失败不会留下半条脏数据');
});
