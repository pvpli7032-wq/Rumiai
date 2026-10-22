/**
 * Mirror 与评理的端到端验收（V3 §8 表 25：「生成可分享、一人一票、结案一次、后台可改规则看结果」）。
 *
 * 一条命令跑完四件事，断言全部落在数据库真实状态上（结果行、票行、判词、快照 JSON），
 * 不看函数返回值的自述：
 *   a. Mirror：提交 → 生成 → 保存 → 分享视图只含公开字段 → 隐藏/过期后 404；
 *   b. 评理投票：一人一票、按创建时快照允许改一次、第三次被拒、不能投自己；
 *   c. 结案只发生一次：并发两次结案只写一条判词、只发一次奖励；
 *   d. 后台改规则：新案例快照用新值，老案例快照不变。
 *
 * 模型一律用本地假上游（SSE）或注入的生成器：不碰任何真实供应商，也不需要密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {createIsolatedDatabase} from '../scripts/helpers/create-isolated-db.mjs';

const HOUR = 3_600_000;
/** 假上游要回的内容：一份结构合格的结果 JSON，服务端会照常校验与截断。 */
const MIRROR_OUTPUT = JSON.stringify({
  title: '安静的观察者',
  observations: ['你说话前会先停一下', '你把关心藏在细节里', '你不喜欢被安排'],
  quote: '你比你以为的更温柔。',
  indices: {atmosphere: 72, rapport: 88},
});
const upstream = createServer((_request, response) => {
  response.writeHead(200, {'Content-Type': 'text/event-stream'});
  response.end('data: ' + JSON.stringify({choices: [{delta: {content: MIRROR_OUTPUT}}]}) + '\n\ndata: [DONE]\n\n');
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');

const file = `playbook-e2e-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.MIRROR_IP_SALT = 'test-salt-not-a-secret';
process.env.OPENAI_API_KEY = 'local-fixture-only';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${upstream.address().port}/v1`;
const built = createIsolatedDatabase(path.resolve('prisma', file));
assert.ok(built.migrations > 0, '至少应用一条迁移');

const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;
const {saveGroup} = await import('../src/lib/settings/service.ts');
const {generateMirror} = await import('../src/lib/mirror/service.ts');
const {readMirrorResult, deleteMirrorResult} = await import('../src/lib/mirror/repository.ts');
const {readPreviewCard} = await import('../src/app/[locale]/mirror/[shareId]/_preview-card.ts');
const {createDisputeCase, snapshotOf} = await import('../src/lib/disputes/case-service.ts');
const {voteDispute} = await import('../src/lib/disputes/vote-service.ts');
const {closeDisputeCase} = await import('../src/lib/disputes/close-service.ts');

test.after(async () => {
  await db.$disconnect();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

let seq = 0;
async function makeUser() {
  seq += 1;
  // 注册满 72 小时：评理要求账号满 dispute.minAccountAgeHours 才能发起。
  return db.user.create({data: {username: `playbook_${process.pid}_${seq}`, email: `playbook-${process.pid}-${seq}@example.invalid`, passwordHash: 'synthetic-only', createdAt: new Date(Date.now() - 72 * HOUR)}});
}
async function makeCharacter(name) {
  return db.character.create({data: {name, personality: '冷静', background: '合成背景', isPublic: true, reviewStatus: 'APPROVED'}});
}
/** 发起一个评理案例，返回案例 id：会话与摘录都用合成数据，不依赖种子。 */
async function publishCase(author) {
  const character = await makeCharacter('评理角色' + (++seq));
  const conversation = await db.conversation.create({data: {userId: author.id, characterId: character.id, title: '合成会话'}});
  const rows = [];
  for (const [role, text] of [['USER', '今晚吃什么？'], ['ASSISTANT', '煮饭吧。'], ['USER', '可我想吃面。'], ['ASSISTANT', '那明天吃面。']]) {
    rows.push(await db.message.create({data: {conversationId: conversation.id, role, content: text}}));
  }
  const created = await createDisputeCase(author.id, {conversationId: conversation.id, messageIds: rows.map(row => row.id), claim: '这样安排是不是太强势？'});
  return created.caseId;
}
/** 后台改设置：走真实的 saveGroup（带操作人与版本号），不直接改库。 */
let operatorId;
async function setSettings(changes) {
  if (!operatorId) operatorId = (await makeUser()).id;
  const groups = {growth: {}, billing: {}};
  for (const [key, value] of Object.entries(changes)) groups[key.startsWith('billing.') ? 'billing' : 'growth'][key] = value;
  for (const [group, values] of Object.entries(groups)) {
    const entries = Object.entries(values);
    if (!entries.length) continue;
    await saveGroup({group, changes: entries.map(([key, value]) => ({key, value})), expectedVersions: {}, operatorId});
  }
}
const snapshotRow = async caseId => snapshotOf((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {ruleSnapshotJson: true}})).ruleSnapshotJson);

test('a. Mirror：提交 → 生成 → 保存 → 分享只给公开字段 → 隐藏/过期 404', async () => {
  const user = await makeUser();
  const character = await makeCharacter('镜面角色' + (++seq));
  const context = {userId: user.id, subject: null, ipHash: null, cookieQuota: {day: null, count: 0}};
  const answers = ['会先听对方说完', '记得别人随口提过的小事', '不太会拒绝别人'];
  const generated = await generateMirror(context, {answers, characterId: character.id});
  const shareId = generated.result.shareId;

  const row = await db.mirrorResult.findUniqueOrThrow({where: {shareId}});
  assert.equal(row.status, 'READY', '结果真实落库且可读');
  assert.equal(row.userId, user.id);
  assert.deepEqual(JSON.parse(row.answersJson), answers, '三题原回答只保存在结果行里');

  // 分享视图：陌生人拿到的结构里没有 answers，序列化后也搜不到原回答。
  const publicView = await readMirrorResult(shareId, {userId: null, subject: null});
  assert.equal(publicView.kind, 'public');
  assert.equal('answers' in publicView.result, false);
  const wire = JSON.stringify(publicView);
  assert.equal(wire.includes('"answers"'), false);
  for (const answer of answers) assert.equal(wire.includes(answer), false, '分享视图不能夹带原回答');
  assert.equal(publicView.result.title, '安静的观察者');
  assert.equal(publicView.result.observations.length, 3);

  // 本人视图才有原回答；这也是删除权的同一口径。
  const ownerView = await readMirrorResult(shareId, {userId: user.id});
  assert.equal(ownerView.kind, 'owner');
  assert.deepEqual(ownerView.result.answers, answers);

  // 隐藏：状态置 HIDDEN，分享页与预览图数据都读不到。
  await deleteMirrorResult(shareId, {userId: user.id}, null);
  assert.equal((await db.mirrorResult.findUniqueOrThrow({where: {shareId}, select: {status: true}})).status, 'HIDDEN');
  await assert.rejects(readMirrorResult(shareId, {userId: null, subject: null}), error => error.status === 404);
  assert.equal(await readPreviewCard(shareId), null, '预览图与分享页同样 404');

  // 过期：到期时间拨到过去后同样读不到（状态仍是 READY，可见性按 expiresAt 判断）。
  const expiring = await generateMirror(context, {answers, characterId: character.id});
  await db.mirrorResult.update({where: {shareId: expiring.result.shareId}, data: {expiresAt: new Date(Date.now() - 1000)}});
  await assert.rejects(readMirrorResult(expiring.result.shareId, {userId: null, subject: null}), error => error.status === 404);
  assert.equal(await readPreviewCard(expiring.result.shareId), null);
});

test('b. 评理投票：一人一票、按快照允许改一次、第三次被拒、不能投自己', async () => {
  await setSettings({'dispute.maxVoteChanges': 1, 'dispute.participateRewardCoins': 0});
  const author = await makeUser();
  const caseId = await publishCase(author);
  const voter = await makeUser();

  assert.equal((await voteDispute(caseId, voter.id, {choice: 'AUTHOR'})).kind, 'VOTED');
  const revised = await voteDispute(caseId, voter.id, {choice: 'OTHER'});
  assert.equal(revised.kind, 'VOTED');
  assert.equal(revised.reviseCount, 1);
  await assert.rejects(voteDispute(caseId, voter.id, {choice: 'SPLIT'}), error => error.status === 409, '第三次改票必须被拒');

  const votes = await db.disputeVote.findMany({where: {caseId}, select: {choice: true, reviseCount: true}});
  assert.equal(votes.length, 1, '一人一票：只有一行');
  assert.deepEqual({choice: votes[0].choice, reviseCount: votes[0].reviseCount}, {choice: 'OTHER', reviseCount: 1});
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {voteCount: true}})).voteCount, 1);

  await assert.rejects(voteDispute(caseId, author.id, {choice: 'AUTHOR'}), error => error.status === 403, '不能投自己');
  assert.equal(await db.disputeVote.count({where: {caseId}}), 1, '被拒的投票不落行');
});

test('c. 结案只发生一次：并发两次结案只写一条判词、只发一次奖励', async () => {
  await setSettings({'dispute.participateRewardCoins': 5, 'dispute.hotRewardCoins': 10, 'dispute.hotRewardTopN': 3, 'dispute.rewardDailyCapCoins': 0});
  const author = await makeUser();
  const caseId = await publishCase(author);
  const voters = [await makeUser(), await makeUser()];
  for (const [index, voter] of voters.entries()) await voteDispute(caseId, voter.id, {choice: index === 0 ? 'AUTHOR' : 'SPLIT'});

  let generated = 0;
  const generate = async () => { generated += 1; await new Promise(resolve => setTimeout(resolve, 25)); return '这次是我说话太急了。'; };
  // 后台「立即结案」语义：force 跳过到期与票数判断，两个执行者同时进场。
  const results = await Promise.all([closeDisputeCase(caseId, {force: true, generate}), closeDisputeCase(caseId, {force: true, generate})]);
  assert.equal(generated, 1, '两次并发结案只生成一次判词');
  assert.deepEqual(results.map(result => result.status).sort(), ['ALREADY_CLOSED', 'CLOSED']);

  const stored = await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {closeStatus: true, verdictJson: true, closedAt: true}});
  assert.equal(stored.closeStatus, 'CLOSED');
  assert.equal(stored.closedAt !== null, true);
  const verdict = JSON.parse(stored.verdictJson);
  assert.equal(verdict.text, '这次是我说话太急了。');

  // 再结一次（已 CLOSED）不会覆盖判词，也不会追加第二条。
  assert.equal((await closeDisputeCase(caseId, {force: true, generate})).status, 'ALREADY_CLOSED');
  assert.equal(generated, 1);
  assert.deepEqual(JSON.parse((await db.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {verdictJson: true}})).verdictJson), verdict);

  // 奖励不重复：参与奖与热门奖各每人一条，业务键唯一。
  const rewards = await db.coinTransaction.findMany({where: {rewardKey: {contains: caseId}}, select: {rewardKey: true, amount: true}});
  assert.equal(rewards.length, voters.length * 2, '参与奖 + 热门奖各一条，没有重发');
  assert.equal(new Set(rewards.map(row => row.rewardKey)).size, rewards.length);
  assert.equal(rewards.filter(row => row.rewardKey.startsWith('dispute-hot:')).length, voters.length, '热门奖每人一条');
  assert.equal(rewards.filter(row => row.rewardKey.startsWith('dispute-vote:')).length, voters.length, '参与奖每人一条');
});

test('d. 后台改规则：新案例快照用新值，老案例快照不变', async () => {
  await setSettings({'dispute.closeAfterHours': 12, 'dispute.closeAtVotes': 7});
  const author = await makeUser();
  const firstCase = await publishCase(author);
  const firstSnapshot = await snapshotRow(firstCase);
  assert.deepEqual({hours: firstSnapshot.closeAfterHours, votes: firstSnapshot.closeAtVotes}, {hours: 12, votes: 7});

  await setSettings({'dispute.closeAfterHours': 6, 'dispute.closeAtVotes': 3});
  const secondCase = await publishCase(author);
  const secondSnapshot = await snapshotRow(secondCase);
  assert.deepEqual({hours: secondSnapshot.closeAfterHours, votes: secondSnapshot.closeAtVotes}, {hours: 6, votes: 3}, '新案例用新规则');

  // 老案例快照逐字不变（含 capturedAt），结案阈值与改票上限都还按创建时算。
  assert.deepEqual(await snapshotRow(firstCase), firstSnapshot, '改设置不影响已开案例的快照');
  // 截止时间也跟着各自的 closeAfterHours 走。
  const second = await db.disputeCase.findUniqueOrThrow({where: {id: secondCase}, select: {deadlineAt: true, createdAt: true}});
  assert.equal(Math.round((second.deadlineAt.getTime() - second.createdAt.getTime()) / HOUR), 6);
  const first = await db.disputeCase.findUniqueOrThrow({where: {id: firstCase}, select: {deadlineAt: true, createdAt: true}});
  assert.equal(Math.round((first.deadlineAt.getTime() - first.createdAt.getTime()) / HOUR), 12);
});
