import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `story-turn-${process.pid}-${Date.now()}.db`;
// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
// @prisma/client loads .env on first import without overriding existing values,
// so the mock-chat switches must be pinned BEFORE the first src import.
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
const env = {...process.env}; delete env.RUST_LOG;
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');
const {executeStoryTurn} = await import('../src/lib/stories/turn-service.ts');
const {executeChatTurn} = await import('../src/lib/conversations/chat-application-service.ts');
const {POST} = await import('../src/app/api/story-runs/[id]/turns/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: '测试性格', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}]};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const {run} = await createStoryRun(owner.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  return {owner, character, run: {...run, userId: owner.id}};
}

const hashOf = content => createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex');
const turn = (run, content, overrides = {}) => executeStoryTurn({userId: run.userId, runId: run.id, input: {expectedRevision: 0, requestId: randomUUID(), content, ...overrides}, signal: new AbortController().signal});

async function readEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    text += decoder.decode(value, {stream: true});
  }
  return text.split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')));
}
const fails = status => error => error.status === status;

test('a turn streams accepted, deltas, committed, state_pending, done and commits atomically', async () => {
  const f = await fixture();
  const events = await readEvents(await turn(f.run, '你好，开始故事。'));
  const types = events.map(event => event.type);
  assert.deepEqual(types.slice(0, 1), ['accepted']);
  assert.equal(types.at(-1), 'done');
  assert.ok(types.includes('delta'));
  assert.ok(types.includes('committed'));
  assert.deepEqual(types.filter(type => type === 'state_pending').map(type => types.indexOf(type)), [types.indexOf('committed') + 1]);
  const accepted = events[0];
  const committed = events.find(event => event.type === 'committed');
  assert.equal(accepted.revision, 1);
  assert.equal(committed.revision, 2);
  assert.equal(committed.turnId, accepted.turnId);
  assert.ok(committed.userMessageId && committed.assistantMessageId);
  const deltas = events.filter(event => event.type === 'delta').map(event => event.content).join('');
  assert.ok(deltas.length > 0);
  assert.ok(events.every(event => event.turnId === accepted.turnId));

  const run = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});
  assert.equal(run.revision, 2);
  assert.equal(run.lastCommittedTurnNo, 1);
  assert.equal(run.activeTurnId, null);
  const turnRow = await db.storyTurn.findUniqueOrThrow({where: {id: accepted.turnId}});
  assert.equal(turnRow.status, 'COMMITTED');
  assert.equal(turnRow.stateStatus, 'PENDING');
  assert.equal(turnRow.inputMessageId, committed.userMessageId);
  assert.equal(turnRow.assistantMessageId, committed.assistantMessageId);
  assert.ok(turnRow.committedAt);
  const userMessage = await db.message.findUniqueOrThrow({where: {id: committed.userMessageId}});
  assert.equal(userMessage.role, 'USER');
  assert.equal(userMessage.conversationId, f.run.conversationId);
  const assistantMessage = await db.message.findUniqueOrThrow({where: {id: committed.assistantMessageId}});
  assert.equal(assistantMessage.role, 'ASSISTANT');
  assert.equal((await db.character.findUniqueOrThrow({where: {id: f.character.id}})).messageCount, 2);
});

test('the same requestId replays the committed turn; different content conflicts', async () => {
  const f = await fixture();
  const requestId = randomUUID();
  const first = await readEvents(await turn(f.run, '第一回合', {requestId}));
  const committed = first.find(event => event.type === 'committed');
  const before = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});
  const replay = await readEvents(await turn(f.run, '第一回合', {requestId}));
  const replayed = replay.find(event => event.type === 'committed');
  assert.equal(replayed.userMessageId, committed.userMessageId);
  assert.equal(replayed.assistantMessageId, committed.assistantMessageId);
  assert.deepEqual(replay.map(event => event.type).slice(-2), ['state_pending', 'done']);
  assert.equal(await db.storyTurn.count({where: {runId: f.run.id}}), 1);
  assert.equal(await db.message.count({where: {conversationId: f.run.conversationId}}), 2);
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).revision, before.revision);
  await assert.rejects(turn(f.run, '同一键不同内容', {requestId}), error => error.code === 'REQUEST_CONFLICT' && error.status === 409);
});

test('a stale expectedRevision is rejected with the current revision and run view', async () => {
  const f = await fixture();
  await readEvents(await turn(f.run, '推进一回合'));
  await assert.rejects(
    executeStoryTurn({userId: f.owner.id, runId: f.run.id, input: {expectedRevision: 0, requestId: randomUUID(), content: '再来'}, signal: new AbortController().signal}),
    error => {
      assert.equal(error.code, 'REVISION_CONFLICT');
      assert.equal(error.status, 409);
      assert.equal(error.data.currentRevision, 2);
      assert.equal(error.data.run.id, f.run.id);
      assert.equal(JSON.stringify(error.data.run).includes('stateJson'), false);
      return true;
    },
  );
  assert.equal(await db.storyTurn.count({where: {runId: f.run.id}}), 1);
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).activeTurnId, null);
});

test('a second turn cannot start while one is in flight, then the slot is released', async () => {
  const f = await fixture();
  const first = turn(f.run, '占住槽位');
  const stream = await first;
  await assert.rejects(turn(f.run, '并发请求'), fails(409));
  const events = await readEvents(stream);
  assert.equal(events.at(-1).type, 'done');
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).activeTurnId, null);
  const revision = (await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).revision;
  const second = await readEvents(await turn(f.run, '重新发送', {expectedRevision: revision}));
  assert.equal(second[0].type, 'accepted');
});

test('inactive runs, unavailable models and malformed requests never create turns', async () => {
  const f = await fixture();
  await db.storyRun.update({where: {id: f.run.id}, data: {status: 'ENDED'}});
  await assert.rejects(turn(f.run, '还在吗'), error => error.code === 'RUN_NOT_ACTIVE' && error.status === 409);
  await db.storyRun.update({where: {id: f.run.id}, data: {status: 'ACTIVE'}});
  const previous = process.env.DISABLE_MOCK_AI;
  process.env.DISABLE_MOCK_AI = 'true';
  try {
    await assert.rejects(turn(f.run, '你好'), error => error.status === 503);
  } finally { process.env.DISABLE_MOCK_AI = previous; }
  for (const bad of [{expectedRevision: -1, requestId: 'x', content: 'hi'}, {expectedRevision: 0, requestId: 'x'}, {expectedRevision: 0, requestId: 'x', content: '   '}, {expectedRevision: 0, requestId: 'x', content: 'a'.repeat(5001)}, {expectedRevision: 0, content: 'no key'}]) {
    await assert.rejects(executeStoryTurn({userId: f.owner.id, runId: f.run.id, input: bad, signal: new AbortController().signal}), fails(422));
  }
  assert.equal(await db.storyTurn.count({where: {runId: f.run.id}}), 0);
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).activeTurnId, null);
});

test('terminal turns replay their outcome instead of regenerating', async () => {
  const f = await fixture();
  await db.storyTurn.createMany({data: [
    {runId: f.run.id, turnNo: 1, requestId: 'failed-1', requestHash: hashOf('失败的回合'), operation: 'SEND', status: 'FAILED', errorCode: 'UPSTREAM_ERROR', startedAt: new Date()},
    {runId: f.run.id, turnNo: 2, requestId: 'unknown-1', requestHash: hashOf('未知的回合'), operation: 'SEND', status: 'UNKNOWN', startedAt: new Date()},
  ]});
  const failed = await readEvents(await turn(f.run, '失败的回合', {requestId: 'failed-1'}));
  assert.deepEqual(failed.map(event => event.type), ['error', 'done']);
  assert.equal(failed[0].code, 'UPSTREAM_ERROR');
  const unknown = await readEvents(await turn(f.run, '未知的回合', {requestId: 'unknown-1'}));
  assert.equal(unknown[0].code, 'TURN_UNKNOWN');
  assert.equal(await db.storyTurn.count({where: {runId: f.run.id}}), 2);
  assert.equal(await db.message.count({where: {conversationId: f.run.conversationId}}), 0);
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).activeTurnId, null);
});

test('ownership is checked before the idempotency shortcut, so a stranger never learns turn state', async () => {
  const f = await fixture();
  await db.storyTurn.create({data: {runId: f.run.id, turnNo: 1, requestId: 'known-1', requestHash: hashOf('已知回合'), operation: 'SEND', status: 'COMMITTED', startedAt: new Date(), committedAt: new Date()}});
  const stranger = await db.user.create({data: {username: 'turn-stranger', email: 'turn-stranger@example.invalid', passwordHash: 's'}});
  // A stranger reusing the owner's requestId gets the same 404 as an unknown run: no
  // REQUEST_CONFLICT / TURN_IN_PROGRESS answer that would reveal a turn exists.
  for (const requestId of ['known-1', randomUUID()]) {
    await assert.rejects(
      executeStoryTurn({userId: stranger.id, runId: f.run.id, input: {expectedRevision: 0, requestId, content: '已知回合'}, signal: new AbortController().signal}),
      error => error.status === 404 && error.code === 'STORY_NOT_FOUND',
    );
  }
});

test('the old chat send path still refuses story conversations', async () => {
  const f = await fixture();
  await assert.rejects(
    executeChatTurn({userId: f.owner.id, conversationId: f.run.conversationId, mode: 'SEND', input: {request: new Request('http://local', {method: 'POST', body: JSON.stringify({content: 'hello'})})}, signal: new AbortController().signal}),
    fails(409),
  );
  assert.equal(await db.message.count({where: {conversationId: f.run.conversationId}}), 0);
});

test('HTTP layer: auth, malformed bodies and SSE headers', async () => {
  const f = await fixture();
  const token = await signToken({userId: f.owner.id, email: f.owner.email});
  const request = (body, authorized = true) => new Request('http://local.test/turns', {method: 'POST', headers: authorized ? {Authorization: `Bearer ${token}`} : {}, ...(body === undefined ? {} : {body})});
  assert.equal((await POST(request('{}', false), {params: Promise.resolve({id: f.run.id})})).status, 401);
  assert.equal((await POST(request('{'), {params: Promise.resolve({id: f.run.id})})).status, 422);
  assert.equal((await POST(request('{}'), {params: Promise.resolve({id: f.run.id})})).status, 422);
  const response = await POST(request(JSON.stringify({expectedRevision: 0, requestId: randomUUID(), content: 'HTTP 回合'})), {params: Promise.resolve({id: f.run.id})});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  const events = await readEvents(response.body);
  assert.equal(events[0].type, 'accepted');
  assert.equal(events.at(-1).type, 'done');
});
