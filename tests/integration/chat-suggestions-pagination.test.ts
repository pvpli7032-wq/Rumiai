import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('conversation pagination and suggestions preserve ownership, task cost and replay', async t => {
  assert.equal(process.env.DATABASE_URL, undefined, 'fixture owns the database');
  const fixture = await createFixture();
  const previousFetch = globalThis.fetch, previousKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  t.after(async () => {globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY; else process.env.AI_PROVIDER_ENCRYPTION_KEY = previousKey; await fixture.cleanup();});
  const {readUserConversationPage, updateConversation} = await import('@rumiai/backend/modules/conversations/conversation-service');
  const {readChatSuggestionCapability, generateChatSuggestions} = await import('@rumiai/backend/modules/conversations/suggestion-service');
  const {clearCache} = await import('@rumiai/backend/modules/settings/cache');
  const character = await fixture.db.character.create({data: {name: 'suggestion-character', personality: 'fixture character', background: 'isolated fixture background', creatorId: fixture.user.id}});
  await fixture.db.conversation.createMany({data: Array.from({length: 205}, (_, i) => ({userId: fixture.user.id, characterId: character.id, title: 'record-' + i, updatedAt: new Date('2026-01-01')}))});
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await readUserConversationPage(fixture.user.id, {limit: '50', cursor});
    ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 205); assert.equal(new Set(ids).size, 205, 'stable tie order never repeats or loses a conversation');
  assert.equal((await readUserConversationPage(fixture.user.id, {q: 'record-204'})).items.length, 1, 'search covers records beyond a loaded prefix');
  assert.equal((await readUserConversationPage(fixture.admin.id, {})).items.length, 0, 'lists are private');
  const conversationId = ids[0];
  await assert.rejects(() => updateConversation(fixture.user.id, conversationId, {romance: 999}), /系统规则维护/);
  assert.equal((await readChatSuggestionCapability(fixture.user.id, conversationId)).available, false, 'unconfigured suggestions stay closed');

  process.env.AI_PROVIDER_ENCRYPTION_KEY = 'ab'.repeat(32);
  const {encryptProviderSecret} = await import('@rumiai/backend/modules/ai/providers/secret');
  const provider = await fixture.db.aiProvider.create({data: {name: 'fixture-suggestions', baseUrl: 'https://suggestions.example.test/v1', isActive: true, ...encryptProviderSecret('fixture-key-no-real-service')}});
  await fixture.db.aiModel.create({data: {key: 'suggestion-model', displayName: 'Suggestion fixture', modelCode: 'fixture', providerId: provider.id, isActive: true}});
  for (const [key, value] of Object.entries({'chat.suggestions.enabled': true, 'chat.suggestions.count': 2, 'chat.suggestions.maxChars': 120, 'chat.suggestions.dailyLimit': 1, 'ai.taskModel.chatSuggestions': 'suggestion-model', 'budget.task.chatSuggestions': 1, 'prompt.chatSuggestions': 'fixture suggestions prompt', 'billing.dayTimezone': 'Asia/Taipei'})) {
    await fixture.db.operationSetting.upsert({where: {key}, create: {key, group: 'chat', value: JSON.stringify(value), updatedBy: fixture.admin.id}, update: {value: JSON.stringify(value)}});
  }
  clearCache();
  const configured = await readChatSuggestionCapability(fixture.user.id, conversationId);
  assert.equal(new Date(configured.resetAt).getUTCHours(), 16, 'suggestions reset in the configured business timezone');
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://suggestions.example.test/v1/chat/completions', 'no paid or external endpoint is permitted');
    const body = JSON.parse(String(init?.body)); assert.ok(body.messages[0].content.includes('fixture suggestions prompt'));
    calls++;
    return new Response('data: ' + JSON.stringify({choices: [{delta: {content: JSON.stringify(['可以讲讲今天的小事吗？', '你最近喜欢读什么？'])}}]}) + '\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  };
  const messagesBefore = await fixture.db.message.count();
  const first = await generateChatSuggestions(fixture.user.id, conversationId, 'fixture-suggestions-1');
  const replay = await generateChatSuggestions(fixture.user.id, conversationId, 'fixture-suggestions-1');
  assert.deepEqual(replay, first); assert.equal(calls, 1, 'retry replays saved suggestions');
  assert.equal(first.suggestions.length, 2); assert.equal(first.remaining, 0);
  assert.equal(await fixture.db.message.count(), messagesBefore, 'suggestions never send messages');
  assert.equal(await fixture.db.aiDailyUsage.count(), 0, 'suggestions never use chat daily slots');
  assert.equal(await fixture.db.generationCharge.count(), 0, 'suggestions do not charge chat coins');
  const call = await fixture.db.aiCall.findFirstOrThrow({where: {taskType: 'chat_suggestions'}});
  assert.equal(call.operation, 'CHAT_SUGGESTIONS'); assert.equal(call.status, 'SUCCEEDED');
  await assert.rejects(() => generateChatSuggestions(fixture.user.id, conversationId, 'fixture-suggestions-2'), /次数已用完/);
  await assert.rejects(() => generateChatSuggestions(fixture.admin.id, conversationId, 'fixture-suggestions-3'), /Forbidden/);
  const {executeChatTurn} = await import('@rumiai/backend/modules/conversations/chat-application-service');
  await fixture.db.conversation.update({where: {id: conversationId}, data: {aiModel: 'retired-model'}});
  await assert.rejects(() => executeChatTurn({
    userId: fixture.user.id, conversationId, mode: 'SEND',
    input: {request: new Request('https://fixture.test/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: 'do not silently switch model', requestId: 'retired-model-request'})})},
    signal: new AbortController().signal,
  }), /原选择模型已不可用/);
  assert.equal(calls, 1, 'retired selected model is blocked before any upstream request');
  assert.equal(await fixture.db.generationCharge.count(), 0, 'retired model is blocked before billing');
  await fixture.db.memoryFact.create({data: {userId: fixture.user.id, conversationId, text: 'must be removed with conversation', status: 'ACTIVE'}});
  await fixture.db.conversationShare.create({data: {id: 'fixture-share-token', conversationId, snapshotJson: '{}', sourceDigest: 'fixture', messageCount: 0}});
  const {deleteConversation} = await import('@rumiai/backend/modules/conversations/conversation-service');
  await deleteConversation(fixture.user.id, conversationId);
  assert.equal(await fixture.db.memoryFact.count({where: {conversationId}}), 0);
  assert.equal(await fixture.db.conversationShare.count({where: {conversationId}}), 0);
  assert.equal(await fixture.db.chatSuggestionRequest.count({where: {conversationId}}), 0);
  assert.equal(await fixture.db.aiCall.count({where: {conversationId}}), 1, 'AI cost audit remains after deleting conversation');

});
