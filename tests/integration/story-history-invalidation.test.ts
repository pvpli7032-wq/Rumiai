import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('message mutation API composes story invalidation before deleted message links disappear', async t => {
  assert.equal(process.env.DATABASE_URL, undefined, 'fixture must own its database');
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const {PATCH, DELETE} = await import('../../apps/api/src/app/api/conversations/[id]/messages/[messageId]/route');
  const {signToken} = await import('@rumiai/backend/infrastructure/auth/auth');
  const token = await signToken({userId: fixture.user.id, email: fixture.user.email});
  const character = await fixture.db.character.create({data: {name: 'story-history', personality: 'test', background: 'test', creatorId: fixture.user.id}});
  const template = await fixture.db.storyTemplate.create({data: {slug: 'history-invalidation', title: 'History', status: 'PUBLISHED'}});
  const version = await fixture.db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', definitionJson: '{}', characterSnapshotJson: '{}'}});
  const baseState = JSON.stringify({schemaVersion: 1, chapterKey: 'first', facts: ['safe checkpoint']});

  for (const method of ['PATCH', 'DELETE'] as const) await t.test(method, async () => {
    const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id}});
    const run = await fixture.db.storyRun.create({data: {userId: fixture.user.id, conversationId: conversation.id, templateVersionId: version.id, chapterKey: 'first', revision: 2, lastCommittedTurnNo: 2, stateProcessedThroughTurnNo: 2, stateJson: '{"stale":true}', createRequestId: method, startedAt: new Date()}});
    await fixture.db.storyCheckpoint.create({data: {runId: run.id, throughTurnNo: 0, revision: 0, stateJson: baseState}});
    await fixture.db.storyCheckpoint.create({data: {runId: run.id, throughTurnNo: 2, revision: 2, stateJson: '{"stale":true}'}});
    const messages: Array<{id: string}> = [];
    for (const turnNo of [1, 2]) {
      const userMessage = await fixture.db.message.create({data: {conversationId: conversation.id, role: 'USER', content: `original ${turnNo}`, createdAt: new Date(1000 + turnNo * 1000)}});
      const assistant = await fixture.db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: `derived ${turnNo}`, createdAt: new Date(1500 + turnNo * 1000)}});
      messages.push(userMessage, assistant);
      const turn = await fixture.db.storyTurn.create({data: {runId: run.id, turnNo, requestId: `turn-${turnNo}`, requestHash: 'fixture', status: 'COMMITTED', operation: 'SEND', stateStatus: 'READY', startedAt: new Date(), inputMessageId: userMessage.id, assistantMessageId: assistant.id}});
      await fixture.db.storyEvent.create({data: {runId: run.id, sourceTurnId: turn.id, chapterKey: 'first', type: 'FACT', status: 'CONFIRMED', payloadJson: '{"text":"private derived fact"}', sourceMessageId: assistant.id}});
    }
    // Select only assistant messages: edit must withdraw the share before their FK links become null.
    const selected = [messages[1].id, messages[3].id];
    const share = await fixture.db.storyShare.create({data: {runId: run.id, userId: fixture.user.id, title: 'private history', selectedMessageIdsJson: JSON.stringify(selected), snapshotJson: '{"private":"old quoted history"}', storyTurnSelection: {create: selected.map((messageId, position) => ({messageId, position}))}}});
    const params = Promise.resolve({id: conversation.id, messageId: messages[0].id});
    const invoke = method === 'PATCH' ? PATCH : DELETE;
    const unauthorized = await invoke(new Request('http://fixture.test/message', {method}), {params});
    assert.equal(unauthorized.status, 401);
    const response = await invoke(new Request('http://fixture.test/message', {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(method === 'PATCH' ? {body: JSON.stringify({content: 'edited user message'})} : {})}), {params});
    assert.equal(response.status, 200, await response.text());
    const events = await fixture.db.storyEvent.findMany({where: {runId: run.id}});
    assert.equal(events.length, 2);
    assert.ok(events.every(row => row.status === 'INVALIDATED' && row.invalidatedAt && row.payloadJson === '{"schemaVersion":1,"invalidated":true}'));
    assert.equal(await fixture.db.storyCheckpoint.count({where: {runId: run.id, invalidatedAt: {not: null}}}), 1);
    assert.equal(await fixture.db.storyTurn.count({where: {runId: run.id, stateStatus: 'INVALIDATED'}}), 2);
    const updated = await fixture.db.storyRun.findUniqueOrThrow({where: {id: run.id}});
    assert.equal(updated.revision, 3);
    assert.equal(updated.lastCommittedTurnNo, 0);
    assert.equal(updated.stateProcessedThroughTurnNo, 0);
    assert.equal(updated.stateJson, baseState);
    const withdrawn = await fixture.db.storyShare.findUniqueOrThrow({where: {id: share.id}});
    assert.equal(withdrawn.status, 'WITHDRAWN');
    assert.ok(withdrawn.withdrawnAt);
    assert.equal(withdrawn.snapshotJson, '{"schemaVersion":1,"withdrawn":true}');
    assert.equal(await fixture.db.message.count({where: {conversationId: conversation.id}}), method === 'PATCH' ? 1 : 0);
  });
});
