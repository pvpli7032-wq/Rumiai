import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `story-w07-${process.pid}-${Date.now()}.db`;
// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createStoryRun, readStoryRun, listStoryRuns} = await import('../src/lib/stories/repository/run-service.ts');
const {executeStoryTurn} = await import('../src/lib/stories/turn-service.ts');
const {processPendingStateWork} = await import('../src/lib/stories/lifecycle/state-worker.ts');
const {closeChapter, resumeStory} = await import('../src/lib/stories/lifecycle/chapter-service.ts');
const {exportStoryRun, exportAccountStories} = await import('../src/lib/stories/lifecycle/export-service.ts');
const {createStoryShare, withdrawStoryShare} = await import('../src/lib/stories/lifecycle/share-service.ts');
const {eraseAccountConversations} = await import('../src/lib/conversations/privacy.ts');
const {deleteConversation} = await import('../src/lib/conversations/conversation-service.ts');
const {exportAccountData} = await import('../src/lib/accounts/data-export.ts');
const exportRoute = await import('../src/app/api/story-runs/[id]/export/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

/** Own conversation marker text; foreign text must never appear in any export. */
const OWN_TEXT = '我把家族徽章藏在了老宅的书架后面。';
const FOREIGN_TEXT = 'FOREIGN_STORY_MESSAGE_MUST_NOT_LEAK';
const HIDDEN_PLOT = 'HIDDEN_TWIST_FINAL_BOSS';

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: '测试性格', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '测试故事', status: 'PUBLISHED'}});
  // Extra private fields in the definition stay invisible to every export (whitelist rule).
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}, {key: 'next', title: '第二章'}], hiddenPlot: HIDDEN_PLOT};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id, systemPrompt: 'PRIVATE_CHARACTER_PROMPT'})}});
  const {run} = await createStoryRun(owner.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  return {owner, character, template, version, run: {...run, userId: owner.id}};
}

async function commitTurn(run, content, expectedRevision) {
  const stream = await executeStoryTurn({userId: run.userId, runId: run.id, input: {expectedRevision, requestId: randomUUID(), content}, signal: new AbortController().signal});
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    text += decoder.decode(value, {stream: true});
  }
  const events = text.split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')));
  const committed = events.find(event => event.type === 'committed');
  assert.ok(committed, 'turn should commit');
  return committed;
}

async function readyRun() {
  const f = await fixture();
  await commitTurn(f.run, OWN_TEXT, 0);
  const worked = await processPendingStateWork();
  assert.equal(worked.processed, 1);
  return f;
}

test('per-run export is owner-scoped and carries only the privacy whitelist', async () => {
  const f = await readyRun();
  assert.equal((await exportRoute.GET(new Request('http://localhost/export'), {params: Promise.resolve({id: f.run.id})})).status, 401);
  await assert.rejects(exportStoryRun((await db.user.create({data: {username: 'w07-x', email: 'w07-x@example.invalid', passwordHash: 's'}})).id, f.run.id), error => error.status === 404);

  const token = await signToken({userId: f.owner.id, email: f.owner.email, tokenVersion: f.owner.tokenVersion});
  const response = await exportRoute.GET(new Request('http://localhost/export', {headers: {Authorization: `Bearer ${token}`}}), {params: Promise.resolve({id: f.run.id})});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const archive = await response.json();
  assert.equal(archive.run.id, f.run.id);
  assert.equal(archive.run.template.title, '测试故事');
  assert.equal(archive.run.chapter.key, 'opening');
  assert.equal(archive.messages.length, 2);
  // Same-millisecond rows must not be assumed chronological (cuid tiebreak); assert by role.
  assert.equal(archive.messages.find(m => m.role === 'USER').content, OWN_TEXT);
  assert.ok(archive.messages.find(m => m.role === 'ASSISTANT'));
  assert.equal(archive.turns.length, 1);
  assert.equal(archive.turns[0].stateStatus, 'PROCESSED');
  assert.equal(archive.events.length, 1);
  assert.equal(typeof archive.events[0].summary, 'string');

  const raw = JSON.stringify(archive);
  for (const secret of [HIDDEN_PLOT, 'PRIVATE_CHARACTER_PROMPT', 'stateJson', 'leaseOwner', 'requestHash', 'createRequestId', 'payloadJson', FOREIGN_TEXT]) {
    assert.equal(raw.includes(secret), false, secret);
  }
  // The template's own publicSummary is public by design (also in the run view);
  // only the private event envelope (payloadJson above) must never appear.
});

test('offline templates forbid new turns and resume but keep history, export and closing', async () => {
  const f = await readyRun();
  await db.storyTemplate.update({where: {id: f.template.id}, data: {status: 'DRAFT'}});

  // New turns are refused…
  await assert.rejects(executeStoryTurn({userId: f.owner.id, runId: f.run.id, input: {expectedRevision: (await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).revision, requestId: randomUUID(), content: '新回合'}, signal: new AbortController().signal}),
    error => error.status === 422 && error.code === 'STORY_OFFLINE');
  // …and a paused run cannot resume into a new chapter…
  await closeChapter(f.owner.id, f.run.id, {expectedRevision: (await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}})).revision});
  const paused = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});
  assert.equal(paused.status, 'PAUSED');
  await assert.rejects(resumeStory(f.owner.id, f.run.id, {expectedRevision: paused.revision}), error => error.status === 422 && error.code === 'STORY_OFFLINE');
  // …but history stays readable and exportable, and new runs from the offline template are refused.
  const view = await readStoryRun(f.owner.id, f.run.id);
  assert.equal(view.run.status, 'PAUSED');
  assert.equal((await listStoryRuns(f.owner.id)).items.some(item => item.id === f.run.id), true);
  const archive = await exportStoryRun(f.owner.id, f.run.id);
  assert.equal(archive.run.id, f.run.id);
  await assert.rejects(createStoryRun(f.owner.id, {templateVersionId: f.version.id, chapterKey: 'next', requestId: randomUUID()}), error => error.status === 404);
});

test('account closure cascades story data with no residue, inside the same erasure transaction', async () => {
  const f = await readyRun();
  // A mid-flight lease and an active slot must not survive either.
  await db.storyTurn.updateMany({where: {runId: f.run.id}, data: {stateStatus: 'PROCESSING', leaseOwner: 'w07-worker', leaseExpiresAt: new Date(Date.now() + 60000)}});
  await db.storyRun.update({where: {id: f.run.id}, data: {activeTurnId: (await db.storyTurn.findFirstOrThrow({where: {runId: f.run.id}})).id}});
  await db.storyShare.create({data: {runId: f.run.id, userId: f.owner.id, title: '待清理分享', selectedMessageIdsJson: JSON.stringify(['a', 'b'])}});

  await db.$transaction(async tx => { await eraseAccountConversations(tx, f.owner.id); });

  assert.equal(await db.storyRun.count({where: {userId: f.owner.id}}), 0);
  assert.equal(await db.storyTurn.count({where: {run: {userId: f.owner.id}}}), 0);
  assert.equal(await db.storyEvent.count({where: {run: {userId: f.owner.id}}}), 0);
  assert.equal(await db.storyCheckpoint.count({where: {run: {userId: f.owner.id}}}), 0);
  assert.equal(await db.storyShare.count({where: {userId: f.owner.id}}), 0);
  // Public template content is not user-private data and survives (ownerId SetNull on user deletion).
  assert.equal(await db.storyTemplate.count({where: {id: f.template.id}}), 1);
  assert.equal(await exportStoryRun(f.owner.id, f.run.id).catch(error => error.status), 404);
});

test('deleting a whole conversation cascades its story run too', async () => {
  const f = await readyRun();
  await deleteConversation(f.owner.id, f.run.conversationId);
  assert.equal(await db.storyRun.count({where: {id: f.run.id}}), 0);
  assert.equal(await db.storyTurn.count({where: {runId: f.run.id}}), 0);
  assert.equal(await db.storyCheckpoint.count({where: {runId: f.run.id}}), 0);
});

test('the account archive merges the story section without private fields', async () => {
  const f = await readyRun();
  const archive = await exportAccountData(f.owner.id);
  assert.equal(archive.version, 3);
  assert.equal(archive.stories.length, 1);
  const story = archive.stories[0];
  assert.equal(story.id, f.run.id);
  assert.equal(story.template.title, '测试故事');
  assert.equal(story.turns.length, 1);
  assert.equal(story.events.length, 1);
  assert.equal(typeof story.events[0].summary, 'string');
  const raw = JSON.stringify(archive);
  for (const secret of [HIDDEN_PLOT, 'PRIVATE_CHARACTER_PROMPT', 'stateJson', 'leaseOwner', FOREIGN_TEXT]) {
    assert.equal(raw.includes(secret), false, secret);
  }
  // Same snapshot helper used inside a transaction keeps projections identical.
  const section = await db.$transaction(tx => exportAccountStories(tx, f.owner.id));
  assert.deepEqual(section, archive.stories);
});

test('shares snapshot selected messages, withdraw without touching the run, and reject foreign rows', async () => {
  const f = await readyRun();
  const messages = await db.message.findMany({where: {conversationId: f.run.conversationId}, orderBy: {createdAt: 'asc'}, select: {id: true}});
  const runBefore = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});

  await assert.rejects(createStoryShare(f.owner.id, f.run.id, {title: '分享', messageIds: [messages[0].id]}), error => error.status === 422, 'fewer than two messages is refused');
  await assert.rejects(createStoryShare(f.owner.id, f.run.id, {title: '分享', messageIds: ['missing-one', 'missing-two']}), error => error.status === 422, 'messages outside the run are refused');
  await assert.rejects(createStoryShare(f.owner.id, f.run.id, {title: '分享', messageIds: [messages[0].id, messages[0].id]}), error => error.status === 422, 'duplicates are refused');
  const stranger = await db.user.create({data: {username: 'w07-share-x', email: 'w07-share-x@example.invalid', passwordHash: 's'}});
  await assert.rejects(createStoryShare(stranger.id, f.run.id, {title: '分享', messageIds: messages.map(m => m.id)}), error => error.status === 404);

  const {share} = await createStoryShare(f.owner.id, f.run.id, {title: '第一章精选', messageIds: messages.map(m => m.id)});
  assert.equal(share.status, 'PUBLISHED');
  assert.deepEqual(share.selectedMessageIds.sort(), messages.map(m => m.id).sort());
  assert.equal(JSON.stringify(share).includes(OWN_TEXT), false, 'the record stores ids, not a rendered copy');

  await assert.rejects(withdrawStoryShare(stranger.id, f.run.id, share.id), error => error.status === 404);
  const withdrawn = await withdrawStoryShare(f.owner.id, f.run.id, share.id);
  assert.equal(withdrawn.share.status, 'WITHDRAWN');
  assert.ok(withdrawn.share.withdrawnAt);

  const runAfter = await db.storyRun.findUniqueOrThrow({where: {id: f.run.id}});
  assert.equal(runAfter.revision, runBefore.revision, 'withdraw never bumps the run');
  assert.equal(runAfter.status, runBefore.status);
  assert.equal(runAfter.updatedAt.getTime(), runBefore.updatedAt.getTime(), 'withdraw never touches the run row');

  await assert.rejects(withdrawStoryShare(f.owner.id, f.run.id, share.id), error => error.status === 409, 'double withdraw is refused');
  await assert.rejects(withdrawStoryShare(f.owner.id, f.run.id, randomUUID()), error => error.status === 404);
  // Withdrawing never blocks future sharing: a new record is a fresh snapshot.
  const again = await createStoryShare(f.owner.id, f.run.id, {title: '再次精选', messageIds: messages.map(m => m.id)});
  assert.equal(again.share.status, 'PUBLISHED');
  assert.notEqual(again.share.id, share.id);
  assert.equal(await db.storyShare.count({where: {runId: f.run.id}}), 2);
});
