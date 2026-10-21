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
const {createDisputeCase, readDisputeCase, listDisputeCases, snapshotOf, withdrawDisputeCase} = await import('../src/lib/disputes/case-service.ts');
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
async function adminOperator() {
  const user = await makeUser();
  const operator = await db.adminOperator.create({data: {userId: user.id}});
  return {user, operator};
}
/** AdminOperator 的主键是 userId，不是 id。 */
async function updateSettings(operatorUserId, changes) {
  await saveGroup({group: 'growth', changes: Object.entries(changes).map(([key, value]) => ({key, value})), expectedVersions: {}, operatorId: operatorUserId});
}

/** V3 默认值。设置中心是进程内共享状态，每个用例开头都显式归位，避免互相影响。 */
const DEFAULTS = {
  'dispute.dailyLimit': 3, 'dispute.minAccountAgeHours': 24, 'dispute.maxExcerptMessages': 6, 'dispute.claimMaxChars': 60,
  'dispute.maxVoteChanges': 1, 'dispute.closeAfterHours': 48, 'dispute.closeAtVotes': 200, 'dispute.verdictMaxChars': 120,
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
