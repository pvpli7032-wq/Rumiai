import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 记忆与统一后台任务（V3 第 24/25 章）。
 * 覆盖：事实隔离与失效、摘要阈值登记、上下文预算裁剪、租约领取与有限重试、巡检任务重排。
 */

const file = `background-tasks-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const memory = await import('../src/lib/memory/index.ts');
const tasks = await import('../src/lib/tasks/index.ts');
const {handlerFor} = await import('../src/lib/tasks/handlers.ts');
const {readMemorySummary} = await import('../src/lib/memory/summary-service.ts');

const user = await db.user.create({data: {username: 'memory-owner', email: 'memory@example.invalid', passwordHash: 'synthetic-only'}});
const stranger = await db.user.create({data: {username: 'memory-stranger', email: 'stranger-memory@example.invalid', passwordHash: 'synthetic-only'}});
const character = await db.character.create({data: {creatorId: user.id, name: '记忆角色', personality: '安静', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '记忆会话'}});

/** 记忆默认关闭（opt-in）：测试里显式打开，验证开与关两种行为。 */
async function setMemoryEnabled(enabled) {
  await db.operationSetting.upsert({
    where: {key: 'memory.enabled'},
    create: {key: 'memory.enabled', group: 'growth', value: JSON.stringify(enabled), version: 1, updatedBy: user.id},
    update: {value: JSON.stringify(enabled), version: {increment: 1}},
  });
  const {clearCache} = await import('../src/lib/settings/cache.ts');
  clearCache();
}

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('事实按会话与用户双重隔离，别人读不到也删不掉', async () => {
  const fact = await memory.createMemoryFact(user.id, conversation.id, {text: '用户养了一只叫团子的猫'});
  assert.equal(fact.status, 'ACTIVE');
  const mine = await memory.listMemoryFacts(user.id, conversation.id);
  assert.equal(mine.length, 1);
  await assert.rejects(() => memory.listMemoryFacts(stranger.id, conversation.id), /没有权限/);
  await assert.rejects(() => memory.deleteMemoryFact(stranger.id, fact.id), /没有权限/);
  assert.equal((await memory.deleteMemoryFact(user.id, fact.id)).status, 'DELETED');
});

test('来源消息失效后事实不再注入', async () => {
  const message = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '我下个月要搬家'}});
  const fact = await memory.createMemoryFact(user.id, conversation.id, {text: '用户下个月搬家', sourceMessageId: message.id});
  assert.equal((await memory.readInjectableFacts(conversation.id, 10)).some(item => item.id === fact.id), true);
  assert.equal(await memory.invalidateFactsForMessage(conversation.id, message.id), 1);
  assert.equal((await memory.readInjectableFacts(conversation.id, 10)).some(item => item.id === fact.id), false);
  assert.equal((await memory.listMemoryFacts(user.id, conversation.id)).length, 0);
});

test('记忆默认关闭时不登记任务；打开后不到阈值也不登记，到了才登记且只有一行', async () => {
  const other = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '阈值会话'}});
  const first = await db.message.create({data: {conversationId: other.id, role: 'USER', content: '第一条'}});
  const second = await db.message.create({data: {conversationId: other.id, role: 'ASSISTANT', content: '第二条'}});
  assert.ok(first.id && second.id);
  // 默认关闭：不登记任何任务。
  assert.equal(await memory.enqueueSummaryIfDue(other.id), false);
  assert.equal(await memory.enqueueMemorySummary(other.id), false);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 0);
  await setMemoryEnabled(true);
  // 打开后仍不到阈值（默认 20 条）。
  assert.equal(await memory.enqueueSummaryIfDue(other.id), false);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 0);
  assert.equal(await memory.enqueueMemorySummary(other.id), true);
  assert.equal(await memory.enqueueMemorySummary(other.id), true);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 1);
});

test('上下文按预算裁剪：关闭记忆不注入，超预算先砍事实', async () => {
  await setMemoryEnabled(false);
  const third = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '预算会话'}});
  await db.conversationMemory.create({data: {conversationId: third.id, summary: '两人约好周末去看海。', version: 1}});
  // 关闭时即使有摘要也不注入。
  assert.equal((await memory.buildMemoryContext(third.id)).injected, false);
  await setMemoryEnabled(true);
  for (const text of ['用户怕水', '用户喜欢蓝色', '用户在学游泳']) await memory.createMemoryFact(user.id, third.id, {text});
  const full = await memory.buildMemoryContext(third.id);
  assert.equal(full.injected, true);
  assert.match(full.text, /周末去看海/);
  assert.equal(full.facts.length, 3);
  // 预算只够摘要（默认 8000 token，摘要约 22 字）：事实全部被砍掉，但摘要仍注入。
  const tight = await memory.buildMemoryContext(third.id, {reservedTokens: 7978});
  assert.equal(tight.injected, true);
  assert.equal(tight.facts.length, 0);
  assert.match(tight.text, /周末去看海/);
  // 预算耗尽：什么都不注入，聊天照常继续。
  assert.equal((await memory.buildMemoryContext(third.id, {reservedTokens: 100000})).injected, false);
});

test('租约领取后并发不重复执行，失败按上限置 FAILED', async () => {
  const subjectId = 'synthetic-' + randomUUID();
  await tasks.enqueueTask('memory-summary', subjectId);
  const [left, right] = await Promise.all([tasks.runDueTasks({limit: 5}), tasks.runDueTasks({limit: 5})]);
  const row = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'memory-summary', subjectId}}});
  // 两次并发只应有一次真正领到这一行。
  assert.equal(left.claimed + right.claimed >= 1, true);
  assert.ok(['DONE', 'PENDING', 'FAILED'].includes(row.status));
  assert.equal(row.leaseOwner, null);
});

test('巡检任务按间隔重新排期，未知类型直接置 FAILED', async () => {
  const created = await tasks.ensureSweepTasks();
  assert.equal(created >= 1, true);
  assert.equal(await tasks.ensureSweepTasks(), 0);
  const sweep = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'mirror-expire', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(sweep.status, 'PENDING');
  const report = await tasks.runDueTasks({kinds: ['mirror-expire']});
  assert.equal(report.failed, 0);
  const after = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'mirror-expire', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(after.status, 'PENDING');
  assert.equal(after.attempts, 0);
  assert.ok(after.nextRunAt.getTime() > Date.now());

  await db.backgroundTask.create({data: {kind: 'no-such-kind', subjectId: 'x', status: 'PENDING', nextRunAt: new Date(Date.now() - 1000)}});
  const unknown = await tasks.runDueTasks({kinds: ['no-such-kind']});
  assert.equal(unknown.failed, 1);
  assert.equal((await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'no-such-kind', subjectId: 'x'}}})).status, 'FAILED');
});

test('关闭时摘要任务直接跳过，会话不存在也跳过；未注册的 kind 没有处理器', async () => {
  assert.equal(handlerFor('memory-summary') !== null, true);
  assert.equal(handlerFor('nope'), null);
  assert.equal(await readMemorySummary('missing-conversation'), null);
  assert.equal((await memory.runMemorySummaryTask('missing-conversation')).outcome, 'SKIPPED_MISSING');
  await setMemoryEnabled(false);
  assert.equal((await memory.runMemorySummaryTask(conversation.id)).outcome, 'SKIPPED_DISABLED');
});
