import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

// 灰度旗标 F1-F3（V3 第 27 章「渐进上线」）：
// 开 = 503 SERVICE_DISABLED、关 = 行为逐字节不变、三旗标互相独立。
// 注意：所有 turn SSE 必须读到 done 再收尾，未读完的流会在测试结束后继续后台生成。
const file = `story-flags-${process.pid}-${Date.now()}.db`;
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
process.env.CHAT_RATE_LIMIT = '1000';
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');
const {processPendingStateWork} = await import('../src/lib/stories/lifecycle/state-worker.ts');
const createRoute = await import('../src/app/api/story-runs/route.ts');
const turnsRoute = await import('../src/app/api/story-runs/[id]/turns/route.ts');
const closeRoute = await import('../src/app/api/story-runs/[id]/close-chapter/route.ts');
const resumeRoute = await import('../src/app/api/story-runs/[id]/resume/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(databasePath + suffix, {force: true}); });

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: '测试性格', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id, systemPrompt: 'PRIVATE_CHARACTER_PROMPT'})}});
  return {owner, version};
}

const tokens = new Map();
async function authHeader(owner) {
  if (!tokens.has(owner.id)) tokens.set(owner.id, `Bearer ${await signToken({userId: owner.id, email: owner.email, tokenVersion: owner.tokenVersion})}`);
  return {Authorization: tokens.get(owner.id), 'content-type': 'application/json'};
}

async function postCreate(owner, body) {
  return createRoute.POST(new Request('http://localhost/api/story-runs', {method: 'POST', headers: await authHeader(owner), body: JSON.stringify(body)}));
}
async function postTurns(owner, runId, body) {
  return turnsRoute.POST(new Request(`http://localhost/api/story-runs/${runId}/turns`, {method: 'POST', headers: await authHeader(owner), body: JSON.stringify(body)}), {params: Promise.resolve({id: runId})});
}
async function postClose(owner, runId, body) {
  return closeRoute.POST(new Request(`http://localhost/api/story-runs/${runId}/close-chapter`, {method: 'POST', headers: await authHeader(owner), body: JSON.stringify(body)}), {params: Promise.resolve({id: runId})});
}
async function postResume(owner, runId, body) {
  return resumeRoute.POST(new Request(`http://localhost/api/story-runs/${runId}/resume`, {method: 'POST', headers: await authHeader(owner), body: JSON.stringify(body)}), {params: Promise.resolve({id: runId})});
}

async function createRunViaService(owner, version) {
  const {run} = await createStoryRun(owner.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  return run;
}

/** Read an SSE response to completion and return the decoded event list. */
async function readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    text += decoder.decode(value, {stream: true});
  }
  return text.split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')));
}

const revision = runId => db.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true}});

test('flags unset: the three entries behave exactly as before', async () => {
  const f = await fixture();
  const created = await postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()});
  assert.equal(created.status, 201);
  const runId = (await created.json()).run.id;

  const turn = await postTurns(f.owner, runId, {expectedRevision: (await revision(runId)).revision, requestId: randomUUID(), content: '开场消息'});
  assert.equal(turn.status, 200);
  assert.match(turn.headers.get('content-type'), /text\/event-stream/);
  assert.ok((await readEvents(turn)).some(event => event.type === 'committed'));
  // The close gate needs processed state (STATE_NOT_READY semantics), same as the W07 fixture.
  await processPendingStateWork();

  const closed = await postClose(f.owner, runId, {expectedRevision: (await revision(runId)).revision});
  assert.equal(closed.status, 200);
  assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: runId}})).status, 'PAUSED');
});

test('F1 STORY_RUNS_DISABLED: creation refused, list/turns/close unaffected', async () => {
  const f = await fixture();
  const run = await createRunViaService(f.owner, f.version);
  process.env.STORY_RUNS_DISABLED = '1';
  try {
    const refused = await postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()});
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), {error: '故事新开已暂停，请稍后再试。', code: 'SERVICE_DISABLED', flag: 'STORY_RUNS_DISABLED'});
    assert.equal(await db.storyRun.count({where: {userId: f.owner.id}}), 1, 'no new run row');

    const listed = await createRoute.GET(new Request('http://localhost/api/story-runs', {headers: await authHeader(f.owner)}));
    assert.equal(listed.status, 200);

    const turn = await postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: '不受 F1 影响'});
    assert.equal(turn.status, 200);
    assert.ok((await readEvents(turn)).some(event => event.type === 'committed'));
    await processPendingStateWork();

    const closed = await postClose(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision});
    assert.equal(closed.status, 200);
  } finally { delete process.env.STORY_RUNS_DISABLED; }
});

test('F2 STORY_TURNS_DISABLED: turns refused before any reserve or write, create/close unaffected', async () => {
  const f = await fixture();
  const run = await createRunViaService(f.owner, f.version);
  // A processed run so the close gate would pass and the close assertion is meaningful.
  const warmup = await postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: 'F2 之前的回合'});
  assert.equal(warmup.status, 200);
  assert.ok((await readEvents(warmup)).some(event => event.type === 'committed'));
  await processPendingStateWork();
  const turnsBefore = await db.storyTurn.count({where: {runId: run.id}});
  const messagesBefore = await db.message.count({where: {conversationId: run.conversationId}});
  const before = await revision(run.id);
  process.env.STORY_TURNS_DISABLED = '1';
  try {
    const created = await postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()});
    assert.equal(created.status, 201);

    const refused = await postTurns(f.owner, run.id, {expectedRevision: before.revision, requestId: randomUUID(), content: '被 F2 拒绝'});
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), {error: '故事回合已暂停，请稍后再试。', code: 'SERVICE_DISABLED', flag: 'STORY_TURNS_DISABLED'});
    assert.equal(await db.storyTurn.count({where: {runId: run.id}}), turnsBefore, 'no new turn row');
    assert.equal(await db.message.count({where: {conversationId: run.conversationId}}), messagesBefore, 'no new message row');
    assert.deepEqual(await revision(run.id), before, 'revision untouched');

    const closed = await postClose(f.owner, run.id, {expectedRevision: before.revision});
    assert.equal(closed.status, 200);
  } finally { delete process.env.STORY_TURNS_DISABLED; }
});

test('F3 STORY_CLOSE_DISABLED: closing refused, resume/create/turns unaffected', async () => {
  const f = await fixture();
  const run = await createRunViaService(f.owner, f.version);
  // A committed, state-processed run so the close gate itself would pass (STATE_NOT_READY semantics stay intact).
  const turn = await postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: '结章前的回合'});
  assert.equal(turn.status, 200);
  const committed = (await readEvents(turn)).find(event => event.type === 'committed');
  assert.ok(committed);
  await processPendingStateWork();
  assert.equal((await db.storyTurn.findUniqueOrThrow({where: {id: committed.turnId}})).stateStatus, 'PROCESSED');
  process.env.STORY_CLOSE_DISABLED = '1';
  try {
    const refused = await postClose(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision});
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), {error: '结章操作已暂停，请稍后再试。', code: 'SERVICE_DISABLED', flag: 'STORY_CLOSE_DISABLED'});
    assert.equal((await db.storyRun.findUniqueOrThrow({where: {id: run.id}})).status, 'ACTIVE');

    const created = await postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()});
    assert.equal(created.status, 201);
    const turn = await postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: '不受 F3 影响'});
    assert.equal(turn.status, 200);
    // SSE 必须读到 done：未读完的流会在测试结束后继续后台生成，与清库互相踩踏。
    assert.ok((await readEvents(turn)).some(event => event.type === 'committed'));

    // resume 不受限：旗标透传到领域层（ACTIVE run 的 resume 得到领域错误而非 503）。
    const resumed = await postResume(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision});
    assert.notEqual(resumed.status, 503);
  } finally { delete process.env.STORY_CLOSE_DISABLED; }
});

test('flag value semantics: trimmed "1" enables, anything else does not; flags combine independently', async () => {
  const f = await fixture();
  for (const flag of ['STORY_RUNS_DISABLED', 'STORY_TURNS_DISABLED', 'STORY_CLOSE_DISABLED']) {
    const run = await createRunViaService(f.owner, f.version);
    const call = async () => flag === 'STORY_RUNS_DISABLED'
      ? postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()})
      : flag === 'STORY_TURNS_DISABLED'
        ? postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: '旗标值语义'})
        : postClose(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision});
    process.env[flag] = ' 1 ';
    const padded = await call();
    assert.equal(padded.status, 503, flag);
    assert.equal((await padded.json()).flag, flag);
    process.env[flag] = '0';
    const off = await call();
    assert.notEqual(off.status, 503, `${flag}=0 must not disable`);
    await off.text(); // 与 F3 同理：排空响应体，避免后台回合与清库竞争。
    delete process.env[flag];
    assert.equal(await db.storyRun.count({where: {id: run.id}}), 1);
  }
  // 三旗标同时生效：各自入口 503 且带各自 flag 标识。
  const run = await createRunViaService(f.owner, f.version);
  process.env.STORY_RUNS_DISABLED = '1';
  process.env.STORY_TURNS_DISABLED = '1';
  process.env.STORY_CLOSE_DISABLED = '1';
  try {
    const cases = [[await postCreate(f.owner, {templateVersionId: f.version.id, chapterKey: 'opening', requestId: randomUUID()}), 'STORY_RUNS_DISABLED'],
      [await postTurns(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision, requestId: randomUUID(), content: '全关'}), 'STORY_TURNS_DISABLED'],
      [await postClose(f.owner, run.id, {expectedRevision: (await revision(run.id)).revision}), 'STORY_CLOSE_DISABLED']];
    for (const [response, flag] of cases) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).flag, flag);
    }
  } finally { for (const flag of ['STORY_RUNS_DISABLED', 'STORY_TURNS_DISABLED', 'STORY_CLOSE_DISABLED']) delete process.env[flag]; }
});
