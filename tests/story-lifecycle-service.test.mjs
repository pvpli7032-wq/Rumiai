import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `story-lifecycle-${process.pid}-${Date.now()}.db`;
// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
// @prisma/client loads .env on first import without overriding existing values,
// so the mock-chat switches must be pinned BEFORE the first src import.
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');
const {executeStoryTurn} = await import('../src/lib/stories/turn-service.ts');
const {processPendingStateWork} = await import('../src/lib/stories/lifecycle/state-worker.ts');
const {retryStoryState, closeChapter, resumeStory} = await import('../src/lib/stories/lifecycle/chapter-service.ts');
const {editUserMessage, deleteMessageAndFollowing} = await import('../src/lib/conversations/message-service.ts');
// Dependency-inversion wiring: importing the story side registers its invalidation
// handler with message-service (a story edit without it fails closed with 503).
await import('../src/lib/stories/lifecycle/invalidation.ts');
const retryStateRoute = await import('../src/app/api/story-runs/[id]/turns/[turnId]/retry-state/route.ts');
const closeChapterRoute = await import('../src/app/api/story-runs/[id]/close-chapter/route.ts');
const resumeRoute = await import('../src/app/api/story-runs/[id]/resume/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

async function fixture(chapters = [{key: 'opening', title: '开场'}, {key: 'next', title: '第二章'}]) {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: '测试性格', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const {run} = await createStoryRun(owner.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  return {owner, character, run: {...run, userId: owner.id}};
}

const turn = (run, content, overrides = {}) => executeStoryTurn({userId: run.userId, runId: run.id, input: {expectedRevision: overrides.expectedRevision ?? 0, requestId: randomUUID(), content, ...overrides}, signal: new AbortController().signal});

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

/** Runs one mock turn and returns its committed receipt. */
async function commitTurn(run, content, expectedRevision) {
  const events = await readEvents(await turn(run, content, {expectedRevision}));
  const committed = events.find(event => event.type === 'committed');
  assert.ok(committed, 'turn should commit');
  return committed;
}

const runRow = async id => db.storyRun.findUniqueOrThrow({where: {id}});
const turnRow = async id => db.storyTurn.findUniqueOrThrow({where: {id}});

test('the worker extracts state from a committed turn: events, checkpoint, cursor, revision', async () => {
  const f = await fixture();
  const committed = await commitTurn(f.run, '你好，开始故事。', 0);
  assert.equal((await turnRow(committed.turnId)).stateStatus, 'PENDING');

  const result = await processPendingStateWork();
  assert.deepEqual({processed: result.processed, failed: result.failed}, {processed: 1, failed: 0});
  const processed = await turnRow(committed.turnId);
  assert.equal(processed.status, 'COMMITTED');
  assert.equal(processed.stateStatus, 'PROCESSED');
  assert.equal(processed.leaseOwner, null);
  assert.equal(processed.leaseExpiresAt, null);
  assert.equal(processed.errorCode, null);

  const event = await db.storyEvent.findFirstOrThrow({where: {sourceTurnId: committed.turnId}});
  assert.equal(event.type, 'FACT');
  assert.equal(event.status, 'CONFIRMED');
  assert.equal(event.runId, f.run.id);
  assert.equal(event.chapterKey, 'opening');
  assert.equal(event.sourceMessageId, committed.userMessageId);
  const payload = JSON.parse(event.payloadJson);
  assert.ok(payload.publicSummary.includes('【模拟整理】'), 'simulated extraction is labelled');

  const checkpoint = await db.storyCheckpoint.findFirstOrThrow({where: {runId: f.run.id, throughTurnNo: 1}});
  assert.equal(checkpoint.revision, 3);
  const checkpointState = JSON.parse(checkpoint.stateJson);
  assert.equal(checkpointState.chapterKey, 'opening');
  assert.equal(checkpointState.facts.length, 1);

  const run = await runRow(f.run.id);
  assert.equal(run.stateProcessedThroughTurnNo, 1);
  assert.equal(run.revision, 3);
  assert.ok(JSON.parse(run.stateJson).facts[0].includes('【模拟整理】'));

  // Idempotent: nothing pending, nothing written twice.
  const again = await processPendingStateWork();
  assert.equal(again.claimed, 0);
  assert.equal(await db.storyEvent.count({where: {runId: f.run.id}}), 1);
  assert.equal((await runRow(f.run.id)).revision, 3);
});

test('an expired lease is reclaimed and only redoes extraction, never the model reply', async () => {
  const f = await fixture();
  const committed = await commitTurn(f.run, '崩溃前的一回合', 0);
  const messagesBefore = await db.message.findMany({where: {conversationId: f.run.conversationId}, orderBy: {createdAt: 'asc'}});

  // Simulate a worker crash mid-extraction: lease held, lease time already past.
  await db.storyTurn.update({where: {id: committed.turnId}, data: {stateStatus: 'PROCESSING', leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() - 1000), stateAttempts: 1}});
  const result = await processPendingStateWork();
  assert.equal(result.processed, 1);
  assert.equal((await turnRow(committed.turnId)).stateStatus, 'PROCESSED');

  const messagesAfter = await db.message.findMany({where: {conversationId: f.run.conversationId}, orderBy: {createdAt: 'asc'}});
  assert.deepEqual(messagesAfter.map(m => m.id), messagesBefore.map(m => m.id), 'no message was regenerated');

  // A live lease from another worker is never stolen.
  const second = await commitTurn(f.run, '第二个回合', 3);
  await db.storyTurn.update({where: {id: second.turnId}, data: {stateStatus: 'PROCESSING', leaseOwner: 'live-worker', leaseExpiresAt: new Date(Date.now() + 60_000)}});
  const skipped = await processPendingStateWork();
  assert.equal(skipped.claimed, 0);
  assert.equal((await turnRow(second.turnId)).stateStatus, 'PROCESSING');
  await db.storyTurn.update({where: {id: second.turnId}, data: {stateStatus: 'PENDING', leaseOwner: null, leaseExpiresAt: null}});
  assert.equal((await processPendingStateWork()).processed, 1);
});

test('extraction failure keeps the saved replies, marks FAILED, and retry-state requeues it', async () => {
  const f = await fixture();
  // Corrupt stored state is a data-integrity fault: refuse to advance, keep replies.
  await db.storyRun.update({where: {id: f.run.id}, data: {stateJson: 'not-json'}});
  const committed = await commitTurn(f.run, '整理会失败的一回合', 0);
  const assistant = await db.message.findUniqueOrThrow({where: {id: committed.assistantMessageId}});

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await processPendingStateWork();
    assert.equal(result.failed, 1);
  }
  const failed = await turnRow(committed.turnId);
  assert.equal(failed.stateStatus, 'FAILED');
  assert.equal(failed.errorCode, 'STATE_DATA_CORRUPT');
  assert.equal(failed.leaseOwner, null);
  assert.equal((await db.message.findUnique({where: {id: assistant.id}}))?.content, assistant.content, 'the saved reply survives');
  assert.equal(await db.storyEvent.count({where: {runId: f.run.id}}), 0);

  // Revision conflict carries the current revision and run view.
  await assert.rejects(retryStoryState(f.owner.id, f.run.id, committed.turnId, {expectedRevision: 0}), error => {
    assert.equal(error.code, 'REVISION_CONFLICT');
    assert.equal(error.status, 409);
    assert.equal(error.data.currentRevision, 2);
    assert.equal(error.data.run.id, f.run.id);
    return true;
  });

  await db.storyRun.update({where: {id: f.run.id}, data: {stateJson: JSON.stringify({schemaVersion: 1, chapterKey: 'opening', facts: []})}});
  const retried = await retryStoryState(f.owner.id, f.run.id, committed.turnId, {expectedRevision: 2});
  assert.deepEqual(retried, {turnId: committed.turnId, stateStatus: 'PENDING', revision: 3});
  const result = await processPendingStateWork();
  assert.equal(result.processed, 1);
  assert.equal((await turnRow(committed.turnId)).stateStatus, 'PROCESSED');
  assert.equal((await runRow(f.run.id)).stateProcessedThroughTurnNo, 1);
  assert.equal((await runRow(f.run.id)).revision, 4);

  await assert.rejects(retryStoryState(f.owner.id, f.run.id, committed.turnId, {expectedRevision: 4}), error => error.code === 'STATE_NOT_RETRYABLE' && error.status === 422);
  await assert.rejects(retryStoryState(f.owner.id, f.run.id, randomUUID(), {expectedRevision: 4}), error => error.status === 404);
});

test('close-chapter requires the state to be processed through the last committed turn', async () => {
  const f = await fixture();
  const committed = await commitTurn(f.run, '未整理就结章', 0);
  await assert.rejects(closeChapter(f.owner.id, f.run.id, {expectedRevision: 2}), error => error.code === 'STATE_NOT_READY' && error.status === 422);

  await processPendingStateWork();
  await assert.rejects(closeChapter(f.owner.id, f.run.id, {expectedRevision: 2}), error => {
    assert.equal(error.code, 'REVISION_CONFLICT');
    assert.equal(error.status, 409);
    assert.equal(error.data.currentRevision, 3);
    assert.equal(error.data.run.id, f.run.id);
    return true;
  });

  const {run} = await closeChapter(f.owner.id, f.run.id, {expectedRevision: 3});
  assert.equal(run.status, 'PAUSED');
  assert.equal(run.revision, 4);
  const chapterResult = await db.storyEvent.findFirstOrThrow({where: {runId: f.run.id, type: 'CHAPTER_RESULT'}});
  assert.equal(chapterResult.status, 'CONFIRMED');
  assert.equal(chapterResult.chapterKey, 'opening');
  assert.ok(JSON.parse(chapterResult.payloadJson).publicSummary.includes('开场'));
  await assert.rejects(closeChapter(f.owner.id, f.run.id, {expectedRevision: 4}), error => error.code === 'RUN_NOT_ACTIVE' && error.status === 409);

  // A chapter with no committed turns cannot close.
  const g = await fixture();
  await assert.rejects(closeChapter(g.owner.id, g.run.id, {expectedRevision: 0}), error => error.code === 'CHAPTER_NOT_READY' && error.status === 422);
  assert.equal(await db.storyEvent.count({where: {runId: g.run.id}}), 0);
});

test('resume reopens a closed story and advances into the next chapter', async () => {
  const f = await fixture();
  await commitTurn(f.run, '第一章的一回合', 0);
  await processPendingStateWork();
  await closeChapter(f.owner.id, f.run.id, {expectedRevision: 3});

  await assert.rejects(resumeStory(f.owner.id, f.run.id, {expectedRevision: 3}), error => {
    assert.equal(error.code, 'REVISION_CONFLICT');
    assert.equal(error.data.currentRevision, 4);
    return true;
  });
  const {run} = await resumeStory(f.owner.id, f.run.id, {expectedRevision: 4});
  assert.equal(run.status, 'ACTIVE');
  assert.equal(run.chapter.key, 'next');
  assert.equal(run.revision, 5);
  const state = JSON.parse((await runRow(f.run.id)).stateJson);
  assert.equal(state.chapterKey, 'next');
  const checkpoint = await db.storyCheckpoint.findFirstOrThrow({where: {runId: f.run.id, revision: 5}});
  assert.equal(JSON.parse(checkpoint.stateJson).chapterKey, 'next');
  await assert.rejects(resumeStory(f.owner.id, f.run.id, {expectedRevision: 5}), error => error.code === 'RUN_NOT_PAUSED' && error.status === 409);

  // The story accepts new turns again, now in the next chapter.
  const events = await readEvents(await turn(f.run, '第二章继续', {expectedRevision: 5}));
  assert.equal(events.find(event => event.type === 'committed').revision, 7);

  // Without a next chapter the same chapter reopens for ordinary exchange.
  const g = await fixture([{key: 'opening', title: '唯一章节'}]);
  await commitTurn(g.run, '唯一章节的一回合', 0);
  await processPendingStateWork();
  await closeChapter(g.owner.id, g.run.id, {expectedRevision: 3});
  const resumed = await resumeStory(g.owner.id, g.run.id, {expectedRevision: 4});
  assert.equal(resumed.run.status, 'ACTIVE');
  assert.equal(resumed.run.chapter.key, 'opening');
});

test('editing a story message invalidates derived state from that turn in one transaction', async () => {
  const f = await fixture();
  const first = await commitTurn(f.run, '第一回合的原始内容', 0);
  const second = await commitTurn(f.run, '第二回合', 2);
  await processPendingStateWork();
  await processPendingStateWork();
  assert.equal((await runRow(f.run.id)).stateProcessedThroughTurnNo, 2);
  assert.equal(await db.storyEvent.count({where: {runId: f.run.id, status: 'CONFIRMED'}}), 2);

  const edited = await editUserMessage(f.owner.id, f.run.conversationId, first.userMessageId, {content: '第一回合改写后的内容'});
  assert.equal(edited.message.content, '第一回合改写后的内容');
  // The reply of this turn and the whole later turn are dropped. When the commit
  // transaction stamps both messages with the same millisecond, the reply survives
  // the `createdAt >` boundary (pre-existing message-service semantics); either way
  // the story invalidation below runs from the stable turnNo.
  assert.ok(edited.droppedReplies === 3 || edited.droppedReplies === 2, `droppedReplies=${edited.droppedReplies}`);

  assert.equal(await db.storyEvent.count({where: {runId: f.run.id, status: 'CONFIRMED'}}), 0);
  assert.equal(await db.storyEvent.count({where: {runId: f.run.id, status: 'INVALIDATED'}}), 2);
  assert.equal(await db.storyCheckpoint.count({where: {runId: f.run.id, invalidatedAt: null, throughTurnNo: {gt: 0}}}), 0);
  assert.equal((await turnRow(first.turnId)).stateStatus, 'INVALIDATED');
  assert.equal((await turnRow(second.turnId)).stateStatus, 'INVALIDATED');

  const run = await runRow(f.run.id);
  assert.equal(run.lastCommittedTurnNo, 0);
  assert.equal(run.stateProcessedThroughTurnNo, 0);
  assert.equal(run.revision, 7);
  const rebuilt = JSON.parse(run.stateJson);
  assert.equal(rebuilt.chapterKey, 'opening');
  assert.equal(rebuilt.facts?.length ?? 0, 0, 'the old summary is gone from the model-facing state');

  // The story continues from the rebuilt state; the next turn reuses no invalidated number.
  const events = await readEvents(await turn(f.run, '重建后的新回合', {expectedRevision: 7}));
  const committed = events.find(event => event.type === 'committed');
  assert.equal(committed.revision, 9);
  assert.equal((await turnRow(committed.turnId)).turnNo, 3);
  await processPendingStateWork();
  const after = await runRow(f.run.id);
  assert.equal(after.stateProcessedThroughTurnNo, 3);
  assert.ok(JSON.parse(after.stateJson).facts.length === 1 && JSON.parse(after.stateJson).facts[0].includes('第 3 回合'));
});

test('deleting an assistant message invalidates from its own turn and keeps earlier facts', async () => {
  const f = await fixture();
  await commitTurn(f.run, '第一回合', 0);
  const second = await commitTurn(f.run, '第二回合', 2);
  await processPendingStateWork();
  await processPendingStateWork();
  const factsBefore = JSON.parse((await db.storyCheckpoint.findFirstOrThrow({where: {runId: f.run.id, throughTurnNo: 1}})).stateJson).facts;

  const removed = await deleteMessageAndFollowing(f.owner.id, f.run.conversationId, second.assistantMessageId);
  // 1 normally; 2 when the commit stamped the user message with the same millisecond.
  assert.ok(removed.removed === 1 || removed.removed === 2, `removed=${removed.removed}`);

  assert.equal(await db.storyEvent.count({where: {runId: f.run.id, status: 'CONFIRMED'}}), 1);
  assert.equal((await db.storyTurn.findUniqueOrThrow({where: {id: second.turnId}})).stateStatus, 'INVALIDATED');
  const run = await runRow(f.run.id);
  assert.equal(run.lastCommittedTurnNo, 1);
  assert.equal(run.stateProcessedThroughTurnNo, 1);
  assert.equal(run.revision, 7);
  assert.deepEqual(JSON.parse(run.stateJson).facts, factsBefore, 'earlier facts survive the invalidation');
});

test('normal conversations keep their edit and delete semantics untouched', async () => {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '普通角色', personality: '测试', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id, title: '普通聊天'}});
  const first = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '第一条'}});
  await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: '第一条回复'}});
  await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '第二条'}});

  const edited = await editUserMessage(owner.id, conversation.id, first.id, {content: '第一条（改）'});
  assert.equal(edited.message.content, '第一条（改）');
  assert.equal(edited.droppedReplies, 2);
  const deleted = await deleteMessageAndFollowing(owner.id, conversation.id, first.id);
  assert.equal(deleted.removed, 1);
  assert.equal(await db.storyRun.count({where: {conversationId: conversation.id}}), 0);
});

test('HTTP layer: auth, malformed bodies and success envelopes', async () => {
  const f = await fixture();
  const token = await signToken({userId: f.owner.id, email: f.owner.email});
  const request = (url, body, authorized = true) => new Request(`http://local.test${url}`, {method: 'POST', headers: authorized ? {Authorization: `Bearer ${token}`} : {}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const params = extra => Promise.resolve({id: f.run.id, ...extra});

  assert.equal((await retryStateRoute.POST(request(`/story-runs/${f.run.id}/turns/x/retry-state`, {expectedRevision: 0}, false), {params: params({turnId: 'x'})})).status, 401);
  assert.equal((await retryStateRoute.POST(request('/retry-state', {expectedRevision: 0}), {params: params({turnId: 'x'})})).status, 404);
  assert.equal((await closeChapterRoute.POST(request('/close', {expectedRevision: 0}, false), {params: params()})).status, 401);
  assert.equal((await closeChapterRoute.POST(request('/close', {}), {params: params()})).status, 422);
  assert.equal((await resumeRoute.POST(request('/resume', {expectedRevision: 'x'}), {params: params()})).status, 422);
  assert.equal((await resumeRoute.POST(request('/resume', {expectedRevision: 0}), {params: params()})).status, 409);

  const committed = await commitTurn(f.run, 'HTTP 层验证回合', 0);
  const retryResponse = await retryStateRoute.POST(request('/retry-state', {expectedRevision: 2}), {params: params({turnId: committed.turnId})});
  assert.equal(retryResponse.status, 200);
  assert.deepEqual(await retryResponse.json(), {turnId: committed.turnId, stateStatus: 'PENDING', revision: 3});

  await processPendingStateWork();
  const closeResponse = await closeChapterRoute.POST(request('/close', {expectedRevision: 4}), {params: params()});
  assert.equal(closeResponse.status, 200);
  const {run} = await closeResponse.json();
  assert.equal(run.status, 'PAUSED');
  const resumeResponse = await resumeRoute.POST(request('/resume', {expectedRevision: 5}), {params: params()});
  assert.equal(resumeResponse.status, 200);
  assert.equal((await resumeResponse.json()).run.status, 'ACTIVE');
});
