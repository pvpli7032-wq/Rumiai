import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `story-run-${process.pid}-${Date.now()}.db`;
// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createStoryRun, readStoryRun, listStoryRuns} = await import('../src/lib/stories/repository/run-service.ts');
const {createOrReuseConversation, deleteConversation} = await import('../src/lib/conversations/conversation-service.ts');
const {executeChatTurn} = await import('../src/lib/conversations/chat-application-service.ts');
const {editUserMessage, deleteMessageAndFollowing} = await import('../src/lib/conversations/message-service.ts');
const {GET, POST} = await import('../src/app/api/story-runs/route.ts');
const {GET: detail} = await import('../src/app/api/story-runs/[id]/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const stranger = await db.user.create({data: {username: `${name}-other`, email: `${name}-other@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: 'PRIVATE_PERSONA', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}, {key: 'next', title: '下一章'}], hiddenFacts: 'SECRET_PLOT'};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id, prompt: 'PRIVATE_PROMPT'})}});
  const input = {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()};
  return {owner, stranger, character, template, version, definition, input};
}
const fails = status => error => error.status === status;

test('creation is atomic and idempotent; conflict cannot create another conversation or increment counters', async () => {
  const f = await fixture();
  const first = await createStoryRun(f.owner.id, f.input);
  assert.equal(first.created, true);
  assert.equal(first.run.revision, 0);
  const second = await createStoryRun(f.owner.id, f.input);
  assert.equal(second.created, false);
  assert.equal(second.run.id, first.run.id);
  await assert.rejects(createStoryRun(f.owner.id, {...f.input, chapterKey: 'next'}), fails(409));
  assert.equal(await db.conversation.count({where: {userId: f.owner.id}}), 1);
  assert.equal((await db.character.findUnique({where: {id: f.character.id}})).chatCount, 1);
  // Creation replay remains valid even after current chapter has advanced.
  await db.storyRun.update({where: {id: first.run.id}, data: {chapterKey: 'next'}});
  assert.equal((await createStoryRun(f.owner.id, f.input)).run.id, first.run.id);
});

test('invalid JSON, missing chapter, drafts, future publication and private roles do not write', async () => {
  const f = await fixture();
  await assert.rejects(createStoryRun(f.owner.id, {...f.input, chapterKey: 'missing'}), fails(422));
  await db.storyTemplateVersion.update({where: {id: f.version.id}, data: {definitionJson: '{'}});
  await assert.rejects(createStoryRun(f.owner.id, f.input), fails(422));
  await db.storyTemplateVersion.update({where: {id: f.version.id}, data: {definitionJson: JSON.stringify(f.definition), publishedAt: new Date(Date.now() + 60000)}});
  await assert.rejects(createStoryRun(f.owner.id, f.input), fails(404));
  await db.storyTemplateVersion.update({where: {id: f.version.id}, data: {publishedAt: new Date()}});
  await db.storyTemplate.update({where: {id: f.template.id}, data: {status: 'DRAFT'}});
  await assert.rejects(createStoryRun(f.owner.id, f.input), fails(404));
  await db.storyTemplate.update({where: {id: f.template.id}, data: {status: 'PUBLISHED'}});
  await db.character.update({where: {id: f.character.id}, data: {isPublic: false}});
  await assert.rejects(createStoryRun(f.stranger.id, f.input), fails(404));
  assert.equal(await db.storyRun.count({where: {templateVersionId: f.version.id}}), 0);
  assert.equal(await db.conversation.count({where: {characterId: f.character.id}}), 0);
});

test('ownership, withdrawal and DTO projection protect private data', async () => {
  const f = await fixture();
  const {run} = await createStoryRun(f.stranger.id, f.input);
  await assert.rejects(readStoryRun(f.owner.id, run.id), fails(404));
  assert.deepEqual((await listStoryRuns(f.owner.id)).items, []);
  const serialized = JSON.stringify(await readStoryRun(f.stranger.id, run.id));
  for (const secret of ['SECRET_PLOT', 'PRIVATE_PERSONA', 'PRIVATE_PROMPT', 'stateJson', 'leaseOwner', 'createRequestId']) assert.equal(serialized.includes(secret), false);
  await db.character.update({where: {id: f.character.id}, data: {isPublic: false}});
  await assert.rejects(readStoryRun(f.stranger.id, run.id), fails(404));
  await assert.rejects(createStoryRun(f.stranger.id, f.input), fails(404));
  assert.deepEqual((await listStoryRuns(f.stranger.id)).items, []);
});

test('keyset pagination resolves tied timestamps without duplicates and rejects foreign cursors', async () => {
  const f = await fixture();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await createStoryRun(f.owner.id, {...f.input, requestId: `page-${i}`})).run.id);
  await db.storyRun.updateMany({where: {userId: f.owner.id}, data: {updatedAt: new Date('2026-01-01')}});
  const page1 = await listStoryRuns(f.owner.id, {limit: '2'});
  const page2 = await listStoryRuns(f.owner.id, {limit: '2', cursor: page1.nextCursor});
  assert.equal(page2.nextCursor, null);
  assert.deepEqual([...page1.items, ...page2.items].map(run => run.id), ids.sort().reverse());
  await assert.rejects(listStoryRuns(f.stranger.id, {cursor: page1.nextCursor}), fails(404));
  for (const limit of ['0', '101', 'abc', '1.5', '']) await assert.rejects(listStoryRuns(f.owner.id, {limit}), fails(422));
});

test('ordinary chat does not reuse story runs and old writes cannot bypass story lifecycle', async () => {
  const f = await fixture();
  const {run} = await createStoryRun(f.owner.id, f.input);
  const free = await createOrReuseConversation(f.owner.id, {characterId: f.character.id});
  assert.notEqual(free.conversation.id, run.conversationId);
  for (const mode of ['SEND', 'REGENERATE']) {
    await assert.rejects(executeChatTurn({userId: f.owner.id, conversationId: run.conversationId, mode, input: mode === 'SEND' ? {request: new Request('http://local', {method: 'POST', body: JSON.stringify({content: 'hello'})})} : {targetMessageId: 'missing'}, signal: new AbortController().signal}), fails(409));
  }
  assert.equal(await db.message.count({where: {conversationId: run.conversationId}}), 0);
  const message = await db.message.create({data: {conversationId: run.conversationId, role: 'USER', content: 'preserve'}});
  await assert.rejects(editUserMessage(f.owner.id, run.conversationId, message.id, {content: 'change'}), fails(409));
  await assert.rejects(deleteMessageAndFollowing(f.owner.id, run.conversationId, message.id), fails(409));
  assert.equal((await db.message.findUnique({where: {id: message.id}})).content, 'preserve');
  await deleteConversation(f.owner.id, run.conversationId);
  assert.equal(await db.storyRun.findUnique({where: {id: run.id}}), null);
  assert.equal(await db.storyCheckpoint.count({where: {runId: run.id}}), 0);
});

test('HTTP authentication, malformed inputs, create replay and detail statuses', async () => {
  const f = await fixture();
  const token = await signToken({userId: f.owner.id, email: f.owner.email});
  const request = (method = 'GET', body, authorized = true) => new Request('http://local.test/api/story-runs', {method, headers: authorized ? {Authorization: `Bearer ${token}`} : {}, ...(body === undefined ? {} : {body})});
  assert.equal((await GET(request('GET', undefined, false))).status, 401);
  assert.equal((await POST(request('POST', '{}', false))).status, 401);
  assert.equal((await detail(request('GET', undefined, false), {params: Promise.resolve({id: 'missing'})})).status, 401);
  assert.equal((await POST(request('POST', '{'))).status, 422);
  assert.equal((await POST(request('POST', '{}'))).status, 422);
  const created = await POST(request('POST', JSON.stringify(f.input)));
  assert.equal(created.status, 201);
  const {run} = await created.json();
  assert.equal((await POST(request('POST', JSON.stringify(f.input)))).status, 200);
  assert.equal((await detail(request(), {params: Promise.resolve({id: run.id})})).status, 200);
  assert.equal((await GET(request())).status, 200);
});

test('simultaneous creation attempts leave exactly one run, conversation and counter increment', async () => {
  const f = await fixture();
  const attempts = await Promise.allSettled([createStoryRun(f.owner.id, f.input), createStoryRun(f.owner.id, f.input)]);
  assert(attempts.some(result => result.status === 'fulfilled'));
  for (const result of attempts) {
    if (result.status === 'rejected') assert(['P1008', 'P2028', 'P2034'].includes(result.reason.code));
  }
  const replay = await createStoryRun(f.owner.id, f.input);
  assert.equal(replay.created, false);
  assert.equal(await db.storyRun.count({where: {userId: f.owner.id}}), 1);
  assert.equal(await db.conversation.count({where: {userId: f.owner.id}}), 1);
  assert.equal((await db.character.findUnique({where: {id: f.character.id}})).chatCount, 1);
});

test('event projection excludes unconfirmed, invalidated and foreign sources and private payload fields', async () => {
  const f = await fixture();
  const {run} = await createStoryRun(f.owner.id, f.input);
  const message = await db.message.create({data: {conversationId: run.conversationId, role: 'ASSISTANT', content: 'PRIVATE_MESSAGE'}});
  const turn = await db.storyTurn.create({data: {runId: run.id, turnNo: 1, requestId: 'turn1', requestHash: 'hash', operation: 'SEND', status: 'COMMITTED', stateStatus: 'PROCESSED', startedAt: new Date(), assistantMessageId: message.id, leaseOwner: 'PRIVATE_LEASE'}});
  const base = {runId: run.id, sourceTurnId: turn.id, chapterKey: 'opening', type: 'FACT', sourceMessageId: message.id, payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: '公开事实', hidden: 'PRIVATE_EVENT'})};
  await db.storyEvent.create({data: {...base, status: 'CONFIRMED'}});
  await db.storyEvent.create({data: {...base, status: 'PENDING'}});
  await db.storyEvent.create({data: {...base, status: 'CONFIRMED', invalidatedAt: new Date()}});
  const free = await createOrReuseConversation(f.stranger.id, {characterId: f.character.id});
  const foreign = await db.message.create({data: {conversationId: free.conversation.id, role: 'USER', content: 'FOREIGN_CONTENT'}});
  await db.storyEvent.create({data: {...base, status: 'CONFIRMED', sourceMessageId: foreign.id}});
  const result = await readStoryRun(f.owner.id, run.id);
  assert.equal(result.run.events.length, 1);
  assert.deepEqual(result.run.events[0].payload, {summary: '公开事实'});
  for (const secret of ['PRIVATE_MESSAGE', 'PRIVATE_EVENT', 'PRIVATE_LEASE', 'FOREIGN_CONTENT']) assert.equal(JSON.stringify(result).includes(secret), false);
  await deleteConversation(f.owner.id, run.conversationId);
  assert.equal(await db.storyTurn.count({where: {runId: run.id}}), 0);
  assert.equal(await db.storyEvent.count({where: {runId: run.id}}), 0);
});
