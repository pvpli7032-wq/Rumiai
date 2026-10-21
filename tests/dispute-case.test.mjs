import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {createIsolatedDatabase} from '../scripts/helpers/create-isolated-db.mjs';

/**
 * 评理广场（V3 第 24 章）验收：
 * 一人一票、改票次数上限、不能投自己、并发结案只生成一次回应、规则快照不受后续设置变更影响。
 *
 * 模型调用全部用注入的生成器替代：这个测试验证的是「什么情况下生成、生成几次、谁写结果」，
 * 不验证供应商返回什么。
 */

const file = `dispute-case-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
// 独立库：只在本进程用，绝不碰 prisma/.local/dev.db。
const built = createIsolatedDatabase(path.resolve('prisma', file));
assert.ok(built.migrations > 0, '至少应用一条迁移');

const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;
const {signToken} = await import('../src/lib/auth.ts');
const {saveGroup} = await import('../src/lib/settings/service.ts');
const {createDisputeCase, readDisputeCase, listDisputeCases, snapshotOf} = await import('../src/lib/disputes/case-service.ts');
const {withdrawDisputeCase} = await import('../src/lib/disputes/withdraw-service.ts');
const {hideAdminDisputeCase} = await import('../src/lib/admin/dispute-cases-admin.ts');
const {voteDispute} = await import('../src/lib/disputes/vote-service.ts');
const {closeDisputeCase, buildFallbackVerdict, enqueueCloseIfReached, runDisputeCloseTask} = await import('../src/lib/disputes/close-service.ts');
const {GET: listRoute, POST: createRoute} = await import('../src/app/api/disputes/route.ts');
const {GET: detailRoute} = await import('../src/app/api/disputes/[id]/route.ts');
const {POST: voteRoute} = await import('../src/app/api/disputes/[id]/vote/route.ts');
const {POST: withdrawRoute} = await import('../src/app/api/disputes/[id]/withdraw/route.ts');
const {GET: optionsRoute} = await import('../src/app/api/disputes/options/route.ts');
const {GET: excerptRoute} = await import('../src/app/api/disputes/excerpt/route.ts');

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

const HOUR = 3_600_000;
let seq = 0;
async function makeUser(options = {}) {
  seq += 1;
  return db.user.create({data: {
    username: `dispute_user_${process.pid}_${seq}`, email: `dispute-${process.pid}-${seq}@example.invalid`, passwordHash: 'synthetic-only',
    createdAt: new Date(Date.now() - (options.ageHours ?? 72) * HOUR),
  }});
}
async function makeConversation(userId) {
  // 迁移后的空库没有角色：这里建一个合成角色，避免测试依赖种子数据。
  const character = await db.character.findFirst({select: {id: true}}) ?? await db.character.create({data: {
    name: `合成角色${process.pid}`, tagline: '测试用', personality: '冷静', background: '合成背景', creatorId: userId, isPublic: false, reviewStatus: 'PENDING',
  }, select: {id: true}});
  const conversation = await db.conversation.create({data: {userId, characterId: character.id, title: '合成会话'}});
  const rows = [];
  for (const [role, text] of [['USER', '今晚吃什么？'], ['ASSISTANT', '煮饭吧，天气凉。'], ['USER', '可我想吃面。'], ['ASSISTANT', '那我们先煮饭，明天吃面。']]) {
    rows.push(await db.message.create({data: {conversationId: conversation.id, role, content: text}}));
  }
  return {conversation, messages: rows};
}
async function publish(user, conversation, messages, claim = '这样安排是不是太强势？') {
  return createDisputeCase(user.id, {conversationId: conversation.id, messageIds: messages.map(message => message.id), claim});
}
/** 某人的评理奖励流水：只看带业务键的发放，按业务键索引便于断言。 */
async function rewardRows(userId) {
  const rows = await db.coinTransaction.findMany({where: {userId, type: 'EARNED', rewardKey: {not: null}}, orderBy: {createdAt: 'asc'}, select: {amount: true, rewardKey: true, sourceKey: true}});
  return new Map(rows.map(row => [row.rewardKey, row]));
}
/** 玩法事件：写侧只记事实，读侧按 DISTINCT 去重。 */
async function productEvents(subjectKey) {
  const rows = await db.productEvent.findMany({where: {subjectKey}, select: {name: true, userId: true}});
  return rows;
}
async function coinsOf(userId) {
  return (await db.user.findUniqueOrThrow({where: {id: userId}, select: {coins: true}})).coins;
}
async function adminOperator() {
  const user = await makeUser();
  const operator = await db.adminOperator.create({data: {userId: user.id}});
  return {user, operator};
}
/** AdminOperator 的主键是 userId，不是 id。saveGroup 一次只收一组，按 key 前缀分组提交。 */
async function updateSettings(operatorUserId, changes) {
  const groups = {growth: {}, billing: {}};
  for (const [key, value] of Object.entries(changes)) groups[key.startsWith('billing.') ? 'billing' : 'growth'][key] = value;
  for (const [group, values] of Object.entries(groups)) {
    const entries = Object.entries(values);
    if (!entries.length) continue;
    await saveGroup({group, changes: entries.map(([key, value]) => ({key, value})), expectedVersions: {}, operatorId: operatorUserId});
  }
}

/** V3 默认值。设置中心是进程内共享状态，每个用例开头都显式归位，避免互相影响。 */
const DEFAULTS = {
  'dispute.dailyLimit': 3, 'dispute.minAccountAgeHours': 24, 'dispute.maxExcerptMessages': 6, 'dispute.claimMaxChars': 60,
  'dispute.maxVoteChanges': 1, 'dispute.closeAfterHours': 48, 'dispute.closeAtVotes': 200, 'dispute.verdictMaxChars': 120,
  'dispute.participateRewardCoins': 0, 'dispute.hotRewardCoins': 0, 'dispute.hotRewardTopN': 3, 'dispute.rewardDailyCapCoins': 0,
};
let settingsOperator;
async function resetSettings(changes = {}) {
  if (!settingsOperator) {
    const {operator} = await adminOperator();
    settingsOperator = operator.userId;
  }
  await updateSettings(settingsOperator, {...DEFAULTS, ...changes});
}

test('一人一票，重复提交同一选择不改票数也不计改票次数', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const voter = await makeUser();

  const first = await voteDispute(caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(first.kind, 'VOTED');
  assert.equal(first.voteCount, 1);

  const again = await voteDispute(caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(again.kind, 'UNCHANGED');
  assert.equal(again.voteCount, 1, '同一个人重复投同一选择不增加票数');
  assert.equal(again.reviseCount, 0, '没有改选择就不消耗改票次数');
  assert.equal(await db.disputeVote.count({where: {caseId, userId: voter.id}}), 1);

  const second = await voteDispute(caseId, (await makeUser()).id, {choice: 'OTHER'});
  assert.equal(second.voteCount, 2);
  const detail = await readDisputeCase(caseId, voter.id);
  assert.equal(detail.voteCount, 2);
  assert.equal(detail.tally.AUTHOR, 1);
  assert.equal(detail.tally.OTHER, 1);
  assert.equal(detail.myVote?.choice, 'AUTHOR');
});

test('改票次数上限按创建时的规则执行（默认 1 次）', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const voter = await makeUser();

  await voteDispute(caseId, voter.id, {choice: 'AUTHOR'});
  const changed = await voteDispute(caseId, voter.id, {choice: 'SPLIT'});
  assert.equal(changed.kind, 'VOTED');
  assert.equal(changed.reviseCount, 1);
  assert.equal(changed.voteCount, 1, '改票不改总票数');

  await assert.rejects(() => voteDispute(caseId, voter.id, {choice: 'OTHER'}), error => error.status === 409 && /改票/.test(error.message));
  const stored = await db.disputeVote.findUniqueOrThrow({where: {caseId_userId: {caseId, userId: voter.id}}});
  assert.equal(stored.choice, 'SPLIT', '被拒绝的改票不落库');
  assert.equal(stored.reviseCount, 1);
});

test('不能给自己发起的案例投票，也拒绝非法选项', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);

  await assert.rejects(() => voteDispute(caseId, author.id, {choice: 'AUTHOR'}), error => error.status === 403 && /不能给自己/.test(error.message));
  assert.equal(await db.disputeVote.count({where: {caseId}}), 0, '自投不落库');

  const voter = await makeUser();
  await assert.rejects(() => voteDispute(caseId, voter.id, {choice: 'EVERYONE'}), error => error.status === 400);
  const detail = await readDisputeCase(caseId, voter.id);
  assert.equal(detail.myVote, null);
});

test('并发结案只生成一次回应', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  // 先投票（到期后服务端正确地拒绝新票），再把截止时间拨到过去，让多个执行者同时认为该结案了。
  for (let index = 0; index < 3; index += 1) await voteDispute(caseId, (await makeUser()).id, {choice: index === 0 ? 'AUTHOR' : 'SPLIT'});
  await db.disputeCase.update({where: {id: caseId}, data: {deadlineAt: new Date(Date.now() - 1000)}});

  let generated = 0;
  const generate = async () => {
    generated += 1;
    await new Promise(resolve => setTimeout(resolve, 25));
    return '谢谢大家投票，这次是我说话太急了。';
  };
  // 直接压生产入口 closeDisputeCase：六个并发执行者，只允许一次生成、一次写入。
  const results = await Promise.all(Array.from({length: 6}, () => closeDisputeCase(caseId, {generate})));
  assert.equal(generated, 1, '六个并发执行者只能生成一次回应');
  assert.equal(results.filter(result => result.status === 'CLOSED').length, 1, '只有一个执行者写结果');
  assert.equal(results.filter(result => result.status === 'ALREADY_CLOSED').length, 5);

  const stored = await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {closeStatus: true, verdictJson: true, closedAt: true}});
  assert.equal(stored.closeStatus, 'CLOSED');
  assert.equal(stored.closedAt !== null, true);
  const verdict = JSON.parse(stored.verdictJson);
  assert.equal(verdict.status, 'READY');
  assert.equal(verdict.text, '谢谢大家投票，这次是我说话太急了。');
  assert.equal(verdict.outcome.tally.total, 3);

  // 再跑一次：已结案直接返回，不会再生成。
  const later = await closeDisputeCase(caseId);
  assert.equal(later.status, 'ALREADY_CLOSED');
  assert.equal(generated, 1);
});

test('规则快照不受后续设置变更影响', async () => {
  await resetSettings({'dispute.closeAfterHours': 2, 'dispute.closeAtVotes': 3});
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const created = await db.disputeCase.findUniqueOrThrow({where: {id: caseId}});
  const snapshot = snapshotOf(created.ruleSnapshotJson);
  // 另一个同样在「改设置之前」创建的案例，专门用来验证改票上限的快照（第一个稍后会被结案）。
  const early = await publish(author, conversation, messages);

  // 后台把规则改回「宽松」值：已开案例必须继续按创建时的快照执行。
  // 只改「进快照」的四项；claimMaxChars / maxExcerptMessages 是创建期校验，改小会让后面的
  // 新案例直接建不出来，与本用例要验证的快照无关。
  await updateSettings(settingsOperator, {'dispute.maxVoteChanges': 5, 'dispute.closeAfterHours': 48, 'dispute.closeAtVotes': 200, 'dispute.verdictMaxChars': 60});
  const after = snapshotOf((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}})).ruleSnapshotJson);
  assert.deepEqual(after, snapshot, '已开案例的规则快照保持不变');
  assert.equal(after.closeAfterHours, 2);

  const remainingHours = (created.deadlineAt.getTime() - created.createdAt.getTime()) / HOUR;
  assert.ok(Math.abs(remainingHours - 2) < 0.01, '截止时间按创建时快照计算');

  // 票数阈值也用快照：新设置 200 票，旧案例 3 票就该结案。
  await voteDispute(caseId, (await makeUser()).id, {choice: 'AUTHOR'});
  await voteDispute(caseId, (await makeUser()).id, {choice: 'OTHER'});
  await voteDispute(caseId, (await makeUser()).id, {choice: 'SPLIT'});
  assert.equal(await enqueueCloseIfReached(caseId), true, '到快照阈值就登记结案任务');
  const task = await db.backgroundTask.findUniqueOrThrow({where: {kind_subjectId: {kind: 'dispute-close', subjectId: caseId}}});
  assert.equal(task.status, 'PENDING');
  let generated = 0;
  const closed = await closeDisputeCase(caseId, {generate: async () => { generated += 1; return '快照阈值下的结案回应。'; }});
  assert.equal(closed.status, 'CLOSED');
  assert.equal(generated, 1);

  // 改票上限同样只看快照：即便后台调成 5 次，改设置之前创建的案例仍只允许 1 次。
  const voter = await makeUser();
  await voteDispute(early.caseId, voter.id, {choice: 'AUTHOR'});
  await voteDispute(early.caseId, voter.id, {choice: 'OTHER'});
  await assert.rejects(() => voteDispute(early.caseId, voter.id, {choice: 'SPLIT'}), error => error.status === 409 && /改票/.test(error.message));
});

test('模型连续失败时写明确的非 AI 兜底说明，重试有限且只写一次结果', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  await voteDispute(caseId, (await makeUser()).id, {choice: 'OTHER'});
  await voteDispute(caseId, (await makeUser()).id, {choice: 'OTHER'});

  let attempts = 0;
  const result = await closeDisputeCase(caseId, {force: true, generate: async () => { attempts += 1; throw new Error('UPSTREAM_HTTP_502'); }});
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.source, 'FALLBACK');
  assert.equal(attempts, 2, '失败只重试有限次');

  const stored = await db.disputeCase.findUniqueOrThrow({where: {id: caseId}});
  const verdict = JSON.parse(stored.verdictJson);
  assert.equal(verdict.status, 'FALLBACK');
  assert.equal(verdict.text, buildFallbackVerdict({AUTHOR: 0, OTHER: 2, SPLIT: 0, total: 2}, verdict.maxChars));
  assert.match(verdict.text, /非 AI/, '兜底文案必须说明不是模型写的');
  assert.match(verdict.text, /TA 更有理/);
  assert.equal(stored.closeStatus, 'CLOSED');
  assert.equal(verdict.failureReason, 'UPSTREAM_HTTP_502');
});

test('立即结案未到时间不生成；任务处理器不会重复生成', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  let generated = 0;
  const early = await closeDisputeCase(caseId, {generate: async () => { generated += 1; return '不应生成'; }});
  assert.equal(early.status, 'SKIPPED', '未到期、未到票数的案例不会被结案');
  assert.equal(generated, 0);

  const forced = await closeDisputeCase(caseId, {force: true, generate: async () => { generated += 1; return '后台提前结案。'; }});
  assert.equal(forced.status, 'CLOSED');
  assert.equal(generated, 1);
  const task = await runDisputeCloseTask(caseId);
  assert.equal(task.outcome, 'ALREADY_CLOSED');
  assert.equal(generated, 1);
});

test('HTTP 路由串起来能走完 发起 → 详情 → 投票 → 撤回', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const authorToken = await signToken({userId: author.id, email: author.email, tokenVersion: author.tokenVersion});
  const voter = await makeUser();
  const voterToken = await signToken({userId: voter.id, email: voter.email, tokenVersion: voter.tokenVersion});
  const call = (handler, path, init = {}) => handler(new Request(`http://localhost${path}`, init), {params: Promise.resolve({id: init.caseId ?? ''})});

  const created = await createRoute(new Request('http://localhost/api/disputes', {
    method: 'POST',
    headers: {Authorization: `Bearer ${authorToken}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({conversationId: conversation.id, messageIds: messages.slice(0, 2).map(message => message.id), claim: '煮饭还是吃面，谁更强势？'}),
  }));
  assert.equal(created.status, 201);
  const {caseId} = await created.json();

  const anonymousDetail = await detailRoute(new Request(`http://localhost/api/disputes/${caseId}`), {params: Promise.resolve({id: caseId})});
  assert.equal(anonymousDetail.status, 200, '未登录也能看详情');
  const anonymousBody = await anonymousDetail.json();
  assert.equal(anonymousBody.case.canVote, false);
  assert.equal(anonymousBody.case.myVote, null);
  assert.equal(anonymousBody.case.excerptCount, 2);

  const selfVote = await voteRoute(new Request(`http://localhost/api/disputes/${caseId}/vote`, {
    method: 'POST', headers: {Authorization: `Bearer ${authorToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify({choice: 'AUTHOR'}),
  }), {params: Promise.resolve({id: caseId})});
  assert.equal(selfVote.status, 403);

  const voted = await voteRoute(new Request(`http://localhost/api/disputes/${caseId}/vote`, {
    method: 'POST', headers: {Authorization: `Bearer ${voterToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify({choice: 'OTHER'}),
  }), {params: Promise.resolve({id: caseId})});
  assert.equal(voted.status, 200);
  const votedBody = await voted.json();
  assert.equal(votedBody.vote.choice, 'OTHER');
  assert.equal(votedBody.voteCount, 1);
  assert.equal(votedBody.closing, false);

  const detail = await detailRoute(new Request(`http://localhost/api/disputes/${caseId}`, {headers: {Authorization: `Bearer ${voterToken}`}}), {params: Promise.resolve({id: caseId})});
  const detailBody = await detail.json();
  assert.equal(detailBody.case.myVote.choice, 'OTHER');
  assert.equal(detailBody.case.canVote, true);
  assert.equal(detailBody.case.canWithdraw, false);

  const options = await optionsRoute(new Request('http://localhost/api/disputes/options', {headers: {Authorization: `Bearer ${authorToken}`}}));
  assert.equal(options.status, 200);
  assert.equal((await options.json()).options.maxExcerptMessages, 6);

  const excerpt = await excerptRoute(new Request(`http://localhost/api/disputes/excerpt?conversationId=${conversation.id}`, {headers: {Authorization: `Bearer ${authorToken}`}}));
  assert.equal(excerpt.status, 200);
  assert.equal((await excerpt.json()).messages.length, messages.length);

  const withdrawn = await withdrawRoute(new Request(`http://localhost/api/disputes/${caseId}/withdraw`, {method: 'POST', headers: {Authorization: `Bearer ${authorToken}`}}), {params: Promise.resolve({id: caseId})});
  assert.equal(withdrawn.status, 200);
  const gone = await detailRoute(new Request(`http://localhost/api/disputes/${caseId}`, {headers: {Authorization: `Bearer ${voterToken}`}}), {params: Promise.resolve({id: caseId})});
  assert.equal(gone.status, 404);
  void call;
});

test('撤回停止公开访问，但发起人仍能看到自己的状态', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  await withdrawDisputeCase(author.id, caseId);
  await assert.rejects(() => readDisputeCase(caseId, null), error => error.status === 404);
  const own = await readDisputeCase(caseId, author.id);
  assert.equal(own.withdrawn, true);
  const closed = await closeDisputeCase(caseId, {force: true});
  assert.equal(closed.status, 'SKIPPED');
});

test('参与奖：投票成功发一次，改票不重发，金额为 0 不发也不写流水', async () => {
  await resetSettings({'dispute.participateRewardCoins': 8});
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const voter = await makeUser();
  const before = await coinsOf(voter.id);

  await voteDispute(caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(await coinsOf(voter.id), before + 8, '投票成功立刻到账');
  const key = `dispute-vote:${caseId}:${voter.id}`;
  let rows = await rewardRows(voter.id);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(key).amount, 8);
  assert.equal(rows.get(key).sourceKey, 'DISPUTE_VOTE_REWARD');

  // 改票：同一业务键，不重发。
  await voteDispute(caseId, voter.id, {choice: 'SPLIT'});
  assert.equal(await coinsOf(voter.id), before + 8, '改票不重复发参与奖');
  assert.equal((await rewardRows(voter.id)).size, 1);

  // 同一选择再提交：不是 VOTED，同样不发。
  await voteDispute(caseId, voter.id, {choice: 'SPLIT'});
  assert.equal(await coinsOf(voter.id), before + 8);
  assert.equal((await rewardRows(voter.id)).size, 1);

  // 作者给自己投票会被拒，自然也没有奖励。
  await assert.rejects(() => voteDispute(caseId, author.id, {choice: 'AUTHOR'}), error => error.status === 403);
  assert.equal((await rewardRows(author.id)).size, 0);

  // 金额归零后新案例不发奖，也不写流水。
  await resetSettings({'dispute.participateRewardCoins': 0});
  const second = await publish(author, conversation, messages);
  const quiet = await makeUser();
  const quietBefore = await coinsOf(quiet.id);
  await voteDispute(second.caseId, quiet.id, {choice: 'OTHER'});
  assert.equal(await coinsOf(quiet.id), quietBefore);
  assert.equal((await rewardRows(quiet.id)).size, 0, '金额 0 时连流水都不写');
  rows = null;
});

test('热门奖：结案按案例内投票先后取前 N 名，重复结案不重发', async () => {
  await resetSettings({'dispute.hotRewardCoins': 20, 'dispute.hotRewardTopN': 2});
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const first = await makeUser();
  const second = await makeUser();
  const third = await makeUser();
  const thirdBefore = await coinsOf(third.id);
  await voteDispute(caseId, first.id, {choice: 'AUTHOR'});
  await voteDispute(caseId, second.id, {choice: 'AUTHOR'});
  await voteDispute(caseId, third.id, {choice: 'SPLIT'});

  const closed = await closeDisputeCase(caseId, {force: true, generate: async () => '结案回应。'});
  assert.equal(closed.status, 'CLOSED');

  const firstRows = await rewardRows(first.id);
  const secondRows = await rewardRows(second.id);
  const thirdRows = await rewardRows(third.id);
  assert.equal(firstRows.get(`dispute-hot:${caseId}:${first.id}`).amount, 20, '先投票的人拿到热门奖');
  assert.equal(secondRows.get(`dispute-hot:${caseId}:${second.id}`).amount, 20);
  assert.equal(thirdRows.has(`dispute-hot:${caseId}:${third.id}`), false, '第 3 名不在前 2 名内，不发');
  assert.equal(await coinsOf(third.id), thirdBefore, '第 3 名余额不变');

  // 重复结案：已结案直接返回，热门奖不会重发。
  const again = await closeDisputeCase(caseId, {force: true, generate: async () => '不该再生成。'});
  assert.equal(again.status, 'ALREADY_CLOSED');
  assert.equal((await rewardRows(first.id)).get(`dispute-hot:${caseId}:${first.id}`).amount, 20);
  assert.equal((await rewardRows(first.id)).size, 1, '重复结案不重发热门奖');
});

test('每日上限：按业务日截断，只发剩余额度，跨日重新计算', async () => {
  // 用例要开 4 个案例，先放开每日发起次数（与奖励无关）。
  await resetSettings({'dispute.participateRewardCoins': 10, 'dispute.rewardDailyCapCoins': 15, 'dispute.dailyLimit': 10});
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const voter = await makeUser();
  const start = await coinsOf(voter.id);
  const firstCase = await publish(author, conversation, messages);
  const secondCase = await publish(author, conversation, messages);
  const thirdCase = await publish(author, conversation, messages);

  await voteDispute(firstCase.caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(await coinsOf(voter.id), start + 10, '第一笔完整发放');
  // 第二笔只剩 5 币额度：按剩余额度截断，不是全不发。
  await voteDispute(secondCase.caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(await coinsOf(voter.id), start + 15, '第二笔截断到剩余额度');
  const rows = await rewardRows(voter.id);
  assert.equal(rows.get(`dispute-vote:${secondCase.caseId}:${voter.id}`).amount, 5);
  // 第三笔额度已用尽：不发，也不写流水。
  await voteDispute(thirdCase.caseId, voter.id, {choice: 'AUTHOR'});
  assert.equal(await coinsOf(voter.id), start + 15, '额度用尽后不再发');
  assert.equal((await rewardRows(voter.id)).size, 2, '截断到 0 的奖励不写流水');

  // 把昨天的流水挪到「昨天」，今天重新有满额；上限按业务日重置。
  const yesterday = new Date(Date.now() - 86_400_000);
  await db.coinTransaction.updateMany({where: {userId: voter.id}, data: {createdAt: yesterday}});
  const fourthCase = await publish(author, conversation, messages);
  await voteDispute(fourthCase.caseId, voter.id, {choice: 'OTHER'});
  assert.equal(await coinsOf(voter.id), start + 25, '跨业务日重新计算额度');
});

test('玩法漏斗：发起、投票、结案各记一条事实，重复结案不多记', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const voter = await makeUser();
  await voteDispute(caseId, voter.id, {choice: 'AUTHOR'});
  await voteDispute(caseId, voter.id, {choice: 'SPLIT'});
  await closeDisputeCase(caseId, {force: true, generate: async () => '结案回应。'});
  await closeDisputeCase(caseId, {force: true, generate: async () => '不该再生成。'});

  const events = await productEvents(caseId);
  assert.deepEqual(events.map(row => row.name).sort(), ['dispute_closed', 'dispute_started', 'dispute_voted', 'dispute_voted'], '改票不额外记投票事件');
  assert.equal(events.find(row => row.name === 'dispute_started').userId, author.id, '发起事件记在发起人身上');
  assert.equal(events.find(row => row.name === 'dispute_closed').userId, null, '结案事件不记到某个用户');
});

test('撤回：只有发起人、只有 OPEN 状态能撤回，其余给中文原因', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const other = await makeUser();

  // 非发起人：不能撤回，且案例仍然公开。
  await assert.rejects(() => withdrawDisputeCase(other.id, caseId), error => error.status === 403 && /只能撤回自己发起的案例/.test(error.message));
  assert.notEqual((await readDisputeCase(caseId, other.id)).withdrawn, true, '撤回被拒后案例仍然公开');

  // 结案中：不能撤回，文案说清原因。
  await db.disputeCase.update({where: {id: caseId}, data: {closeStatus: 'CLOSING'}});
  await assert.rejects(() => withdrawDisputeCase(author.id, caseId), error => error.status === 409 && /正在结案/.test(error.message));
  await db.disputeCase.update({where: {id: caseId}, data: {closeStatus: 'OPEN'}});

  // 已结案：不能撤回，结案结果不能被撤回掉。
  await closeDisputeCase(caseId, {force: true, generate: async () => '结案回应。'});
  await assert.rejects(() => withdrawDisputeCase(author.id, caseId), error => error.status === 409 && /已经结案/.test(error.message));

  // OPEN 状态撤回成功，且重复撤回幂等。
  const second = await publish(author, conversation, messages);
  assert.deepEqual(await withdrawDisputeCase(author.id, second.caseId), {withdrawn: true});
  assert.deepEqual(await withdrawDisputeCase(author.id, second.caseId), {withdrawn: true}, '重复撤回不报错');
  await assert.rejects(() => readDisputeCase(second.caseId, other.id), error => error.status === 404, '非发起人访问返回 404');
  assert.equal((await readDisputeCase(second.caseId, author.id)).withdrawn, true, '发起人仍能看到自己撤回的案例');
  const post = await db.post.findUniqueOrThrow({where: {id: second.postId}, select: {status: true}});
  assert.equal(post.status, 'HIDDEN', '撤回后帖子停止公开访问');
  // 撤回后结案任务不再生成回应。
  const closed = await closeDisputeCase(second.caseId, {force: true, generate: async () => { throw new Error('撤回后不该生成'); }});
  assert.equal(closed.status, 'SKIPPED');
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: second.caseId}, select: {closeStatus: true}})).closeStatus, 'WITHDRAWN');
});

test('后台隐藏：非发起人 404、投票停止、结案任务不再生成回应，原因与操作人留痕', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId, postId} = await publish(author, conversation, messages);
  const voter = await makeUser();
  const operator = await makeUser();
  // 截止时间拨到过去：这条案例本来该结案，被隐藏后必须不再生成回应。
  await db.disputeCase.update({where: {id: caseId}, data: {deadlineAt: new Date(Date.now() - 1000)}});

  const hidden = await hideAdminDisputeCase(operator.id, caseId, '含未授权联系方式');
  assert.deepEqual(hidden, {caseId, hidden: true, alreadyHidden: false});
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {closeStatus: true}})).closeStatus, 'WITHDRAWN');
  assert.equal((await db.post.findUniqueOrThrow({where: {id: postId}, select: {status: true}})).status, 'HIDDEN', '帖子停止公开访问');
  // 原因与操作人只在 admin_audit_logs，不新增字段。
  const audit = await db.adminAuditLog.findFirstOrThrow({where: {action: 'DISPUTE_CASE_HIDDEN', targetId: caseId}});
  assert.equal(audit.actorId, operator.id);
  assert.equal(audit.reason, '含未授权联系方式');

  // 非发起人 404、投票停止、结案任务不再生成回应。
  await assert.rejects(() => readDisputeCase(caseId, voter.id), error => error.status === 404);
  await assert.rejects(() => voteDispute(caseId, voter.id, {choice: 'AUTHOR'}), error => error.status === 404);
  let generated = 0;
  const closed = await closeDisputeCase(caseId, {generate: async () => { generated += 1; return '被隐藏的案例不该生成回应'; }});
  assert.equal(closed.status, 'SKIPPED');
  assert.equal(generated, 0, '隐藏后不再生成角色回应');
  assert.equal((await runDisputeCloseTask(caseId)).outcome, 'SKIPPED', '结案任务直接跳过');
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {closeStatus: true}})).closeStatus, 'WITHDRAWN');
  // 发起人自己仍能看到状态（「我参与的」不受影响）。
  assert.equal((await readDisputeCase(caseId, author.id)).withdrawn, true);

  // 重复隐藏幂等，但每次后台操作本身都留痕；缺原因直接拒绝且不写日志。
  const again = await hideAdminDisputeCase(operator.id, caseId, '再次确认');
  assert.equal(again.alreadyHidden, true);
  assert.equal(await db.adminAuditLog.count({where: {action: 'DISPUTE_CASE_HIDDEN', targetId: caseId}}), 2);
  await assert.rejects(() => hideAdminDisputeCase(operator.id, caseId, '   '), error => /1–300 字/.test(error.message));
  assert.equal(await db.adminAuditLog.count({where: {action: 'DISPUTE_CASE_HIDDEN', targetId: caseId}}), 2);
});

test('并发投票：同一用户同时投多次只落一张票，票数只加一次', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  const voter = await makeUser();

  // 六个并发请求，选择还各不相同：唯一键 (caseId,userId) 兜住，改票次数也只按一次算。
  const choices = ['AUTHOR', 'OTHER', 'SPLIT', 'AUTHOR', 'OTHER', 'SPLIT'];
  const results = await Promise.allSettled(choices.map(choice => voteDispute(caseId, voter.id, {choice})));
  const accepted = results.filter(result => result.status === 'fulfilled');
  assert.equal(accepted.length >= 1, true, '至少一次请求成功');
  assert.equal(await db.disputeVote.count({where: {caseId, userId: voter.id}}), 1, '只落一张票');
  const stored = await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {voteCount: true}});
  assert.equal(stored.voteCount, 1, '票数只加一次');
  const vote = await db.disputeVote.findUniqueOrThrow({where: {caseId_userId: {caseId, userId: voter.id}}});
  assert.equal(vote.reviseCount <= 1, true, '改票次数不会被并发多算');
  // 失败的那些必须是明确的业务冲突，不是 500。
  for (const result of results) {
    if (result.status === 'rejected') assert.equal(result.reason.status, 409, '并发冲突返回 409 而不是 500');
  }
});

test('并发结案：两个 worker 同时处理同一案例只生成一次回应', async () => {
  await resetSettings();
  const author = await makeUser();
  const {conversation, messages} = await makeConversation(author.id);
  const {caseId} = await publish(author, conversation, messages);
  await voteDispute(caseId, (await makeUser()).id, {choice: 'AUTHOR'});
  await voteDispute(caseId, (await makeUser()).id, {choice: 'OTHER'});
  await db.disputeCase.update({where: {id: caseId}, data: {deadlineAt: new Date(Date.now() - 1000)}});

  let generated = 0;
  const generate = async () => {
    generated += 1;
    await new Promise(resolve => setTimeout(resolve, 30));
    return '两个 worker 里只有一个该写结果。';
  };
  // 任务处理器是两个独立 worker 的入口：都认为该结案，但只有抢占成功的一方生成。
  const workers = await Promise.all([runDisputeCloseTask(caseId), runDisputeCloseTask(caseId)]);
  assert.equal(generated, 0, 'worker 入口走真实模型链路，这里只校验结案结果唯一');
  assert.equal(workers.filter(worker => worker.outcome === 'CLOSED').length, 1, '两个 worker 里只有一个结案');
  assert.equal(workers.filter(worker => worker.outcome === 'ALREADY_CLOSED').length, 1, '另一个看到已经结案');
  assert.equal(await db.disputeCase.count({where: {id: caseId, closeStatus: 'CLOSED'}}), 1, '只结一次案');
  const verdict = JSON.parse((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {verdictJson: true}})).verdictJson);
  assert.equal(typeof verdict.text, 'string');

  // 再用注入生成器压一次：同样的抢占，只生成一次。
  const fresh = await publish(author, conversation, messages);
  await db.disputeCase.update({where: {id: fresh.caseId}, data: {deadlineAt: new Date(Date.now() - 1000)}});
  const both = await Promise.all([closeDisputeCase(fresh.caseId, {generate}), closeDisputeCase(fresh.caseId, {generate})]);
  assert.equal(generated, 1, '两个 worker 只生成一次回应');
  assert.equal(both.filter(result => result.status === 'CLOSED').length, 1);
  assert.equal(both.filter(result => result.status === 'ALREADY_CLOSED').length, 1);
});

test('发起资格：每日上限与注册时长按设置执行，HTTP 路由保留鉴权与错误码', async () => {
  await resetSettings({'dispute.dailyLimit': 1});
  const young = await makeUser({ageHours: 1});
  const {conversation, messages} = await makeConversation(young.id);
  await assert.rejects(() => publish(young, conversation, messages), error => error.status === 403 && /注册满/.test(error.message));

  const author = await makeUser({ageHours: 48});
  const convo = await makeConversation(author.id);
  const first = await publish(author, convo.conversation, convo.messages);
  assert.ok(first.caseId);
  const second = await makeConversation(author.id);
  await assert.rejects(() => publish(author, second.conversation, second.messages), error => error.status === 429);

  // 上面的 429 已经把当日额度用满；校验类用例要先把额度放回来，否则只会测到 429。
  await updateSettings(settingsOperator, {'dispute.dailyLimit': 3});
  // 摘录必须是连续消息
  await assert.rejects(() => publish(author, convo.conversation, [convo.messages[0], convo.messages[3]]), error => error.status === 400 && /连续/.test(error.message));
  // 诉求超长
  await assert.rejects(() => publish(author, convo.conversation, [convo.messages[0]], '我要'.repeat(60)), error => error.status === 400 && /诉求最多/.test(error.message));

  const anonymous = await createRoute(new Request('http://localhost/api/disputes', {method: 'POST', body: '{}'}));
  assert.equal(anonymous.status, 401);
  const token = await signToken({userId: author.id, email: author.email, tokenVersion: author.tokenVersion});
  const response = await listRoute(new Request('http://localhost/api/disputes?sort=latest', {headers: {Authorization: `Bearer ${token}`}}));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
  const page = await response.json();
  // 公开列表是所有未撤回案例，本文件其它用例也建过案例，所以只断言作者这条在列表里。
  const mineItem = page.items.find(item => item.id === first.caseId);
  assert.ok(mineItem, '作者刚发起的案例应出现在最新列表里');
  assert.equal(mineItem.claim, '这样安排是不是太强势？');

  const joined = await listDisputeCases({sort: 'joined', userId: author.id});
  assert.equal(joined.items.length, 1);
  await assert.rejects(() => listDisputeCases({sort: 'joined', userId: null}), error => error.status === 401);
});
