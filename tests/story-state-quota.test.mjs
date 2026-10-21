import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `story-state-quota-${process.pid}-${Date.now()}.db`;
// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
// Pin BEFORE the first src import: a configured key forces the worker's real-AI
// path. 每日上限来自设置中心（billing.hardDailyMessages），建库后写成 0 让
// reserveAiCall 拒绝每一次调用。
process.env.OPENAI_API_KEY = 'test-key-forced-real-path';
process.env.DISABLE_MOCK_AI = 'false';
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
// 上限 0 = 暂停新请求（不是无限）：worker 的每次 reserveAiCall 都应被拒。
await db.operationSetting.upsert({where: {key: 'billing.hardDailyMessages'}, create: {key: 'billing.hardDailyMessages', group: 'chat', value: '0', version: 1, updatedBy: 'test-operator'}, update: {value: '0', version: {increment: 1}, updatedBy: 'test-operator'}});
clearKeyEverywhere('billing.hardDailyMessages');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');
const {processPendingStateWork} = await import('../src/lib/stories/lifecycle/state-worker.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: '测试性格', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}]};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const {run} = await createStoryRun(owner.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  return {owner, run: {...run, userId: owner.id}};
}

const hashOf = content => createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex');

/** A committed turn with saved messages, built directly (chat quota is exhausted). */
async function committedTurn(f, requestId) {
  const userMessage = await db.message.create({data: {conversationId: f.run.conversationId, role: 'USER', content: '额度耗尽前的一回合'}});
  const assistantMessage = await db.message.create({data: {conversationId: f.run.conversationId, role: 'ASSISTANT', content: '已保存的回复'}});
  const turn = await db.storyTurn.create({data: {
    runId: f.run.id, turnNo: 1, requestId, requestHash: hashOf('额度耗尽前的一回合'), operation: 'SEND',
    status: 'COMMITTED', committedAt: new Date(), startedAt: new Date(),
    inputMessageId: userMessage.id, assistantMessageId: assistantMessage.id,
  }});
  await db.storyRun.update({where: {id: f.run.id}, data: {lastCommittedTurnNo: 1, revision: 2}});
  return {turn, userMessage, assistantMessage};
}

test('budget exhaustion defers extraction: task stays PENDING, replies untouched, no attempt burned', async () => {
  const f = await fixture();
  const {turn} = await committedTurn(f, randomUUID());

  const result = await processPendingStateWork();
  assert.equal(result.deferred, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 0);

  const row = await db.storyTurn.findUniqueOrThrow({where: {id: turn.id}});
  assert.equal(row.stateStatus, 'PENDING', 'the task survives for a later scan');
  assert.equal(row.errorCode, 'QUOTA_DEFERRED');
  assert.equal(row.leaseOwner, null);
  assert.equal(row.stateAttempts, 1, 'deferral is claimed once and never counts toward MAX_ATTEMPTS');
  const run = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});
  assert.equal(run.stateProcessedThroughTurnNo, 0);
  assert.equal(run.revision, 2, 'a deferred extraction writes no state and bumps no revision');
  assert.equal(await db.storyEvent.count({where: {runId: f.run.id}}), 0);
  assert.equal(await db.storyCheckpoint.count({where: {runId: f.run.id, throughTurnNo: {gt: 0}}}), 0, 'only the initial checkpoint exists');
  assert.ok(await db.message.findUnique({where: {id: (await db.storyTurn.findUniqueOrThrow({where: {id: turn.id}})).assistantMessageId}}), 'the committed reply survives');
  assert.equal(await db.aiCall.count({where: {userId: f.owner.id}}), 0, 'no call is recorded when the reservation itself is refused');
});
