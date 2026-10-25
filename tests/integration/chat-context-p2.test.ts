import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('P2 chat versions, branches and private context are durable and isolated', async t => {
  assert.equal(process.env.DATABASE_URL, undefined);
  const fixture = await createFixture(), originalFetch = globalThis.fetch;
  const savedKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  t.after(async () => {globalThis.fetch = originalFetch; if (savedKey === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY; else process.env.AI_PROVIDER_ENCRYPTION_KEY = savedKey; await fixture.cleanup();});
  process.env.AI_PROVIDER_ENCRYPTION_KEY = 'ac'.repeat(32);
  const {encryptProviderSecret} = await import('@rumiai/backend/modules/ai/providers/secret');
  const provider = await fixture.db.aiProvider.create({data: {name: 'p2-fixture', baseUrl: 'https://p2-chat.example.test/v1', isActive: true, ...encryptProviderSecret('synthetic-test-key')}});
  await fixture.db.aiModel.create({data: {key: 'p2-model', modelCode: 'fixture', displayName: 'P2 fixture', providerId: provider.id, isActive: true, isDefault: true}});
  for (const [key, value] of Object.entries({
    'memory.enabled': true, 'chat.personaMaxChars': 2000, 'chat.personalOverrideMaxChars': 4000,
    'chat.worldbooks.enabled': true, 'chat.worldbooks.contextMaxChars': 4000, 'chat.worldbooks.maxEntries': 100, 'chat.worldbooks.entryMaxChars': 2000,
    'chat.responseStyles': [{key: 'natural', label: '自然', instruction: 'fixture-style-instruction'}], 'chat.responseLengths': [],
    'chat.revisions.enabled': true, 'chat.revisions.pricingPolicy': 'REGENERATE', 'chat.revisions.maxInstructionChars': 2000,
    'ai.taskModel.chatRevision': 'p2-model', 'budget.task.chatRevision': 1, 'billing.chargingEnabled': false,
  })) await fixture.db.operationSetting.create({data: {key, group: 'chat', value: JSON.stringify(value), updatedBy: fixture.admin.id}});
  const {clearCache} = await import('@rumiai/backend/modules/settings/cache'); clearCache();
  const character = await fixture.db.character.create({data: {name: 'P2角色', personality: 'fixture-character', background: 'fixture-background', creatorId: fixture.user.id}});
  const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id}});
  const {savePersona, deletePersona} = await import('@rumiai/backend/modules/personas/service');
  const {saveWorldbook, saveWorldbookEntry} = await import('@rumiai/backend/modules/worldbooks/service');
  const {saveConversationContextSettings, readConversationContextSettings} = await import('@rumiai/backend/modules/conversations/context/settings');
  const {buildAdvancedContext, readContextUse} = await import('@rumiai/backend/modules/conversations/context/builder');
  const {chooseMessageVersion, listMessageVersions, setMessageContextIncluded, recordMessageFeedback} = await import('@rumiai/backend/modules/conversations/revisions/versions');
  const {createConversationBranch} = await import('@rumiai/backend/modules/conversations/branches/service');
  const persona = await savePersona(fixture.user.id, null, {name: '我的身份', description: 'fixture-persona-detail'});
  const book = await saveWorldbook(fixture.user.id, null, {name: '私有背景', enabled: true, isPublic: false});
  await saveWorldbookEntry(fixture.user.id, book.id, null, {keywords: ['青鸟'], content: 'fixture-worldbook-detail', priority: 10, enabled: true});
  await saveConversationContextSettings(fixture.user.id, conversation.id, {personaId: persona.id, personalCharacterOverride: 'fixture-private-override', responseStyle: 'natural', worldbookIds: [book.id]});
  const advanced = await buildAdvancedContext(fixture.user.id, conversation.id, '青鸟今天出现了吗？');
  for (const marker of ['fixture-persona-detail', 'fixture-private-override', 'fixture-style-instruction', 'fixture-worldbook-detail']) assert.ok(advanced.text.includes(marker), marker);
  assert.equal((await buildAdvancedContext(fixture.user.id, conversation.id, '没有触发词')).sources.filter(row => row.kind === 'worldbook').length, 0);
  const safe = await readConversationContextSettings(fixture.user.id, conversation.id);
  assert.ok(!JSON.stringify(safe.styles).includes('fixture-style-instruction'), 'private style instructions never reach public option labels');
  await assert.rejects(() => readConversationContextSettings(fixture.admin.id, conversation.id), /无权访问/);
  const publicBook = await saveWorldbook(fixture.admin.id, null, {name: 'other author public book', enabled: true, isPublic: true});
  await saveConversationContextSettings(fixture.user.id, conversation.id, {worldbookIds: [book.id, publicBook.id]});
  const withPublic = await readConversationContextSettings(fixture.user.id, conversation.id);
  assert.ok(withPublic.worldbooks.some(row => row.id === publicBook.id), 'a bound public book remains visible even when it is not the character default');
  await saveWorldbook(fixture.admin.id, publicBook.id, {name: publicBook.name, enabled: true, isPublic: false, version: publicBook.version});
  const retracted = await readConversationContextSettings(fixture.user.id, conversation.id);
  assert.ok(!retracted.settings.worldbookIds.includes(publicBook.id), 'a retracted private book cannot leave an invisible unremovable selection');
  assert.ok(!retracted.worldbooks.some(row => row.id === publicBook.id));
  await saveConversationContextSettings(fixture.user.id, conversation.id, retracted.settings);

  const now = new Date();
  const userMessage = await fixture.db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '青鸟', createdAt: new Date(now.getTime() - 3000)}});
  const reply = await fixture.db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: '原回复。', createdAt: new Date(now.getTime() - 2000)}});
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://p2-chat.example.test/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages.some((row: {content: string}) => row.content.includes('fixture-persona-detail')));
    calls++;
    return new Response('data: ' + JSON.stringify({choices: [{delta: {content: '续写内容。'}, finish_reason: null}]}) + '\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  };
  const {executeChatTurn} = await import('@rumiai/backend/modules/conversations/chat-application-service');
  const generate = () => executeChatTurn({userId: fixture.user.id, conversationId: conversation.id, mode: 'REGENERATE', input: {targetMessageId: reply.id, requestId: 'p2-continue-request', revision: {kind: 'CONTINUE'}}, signal: new AbortController().signal});
  await new Response((await generate()).stream).text();
  const updated = await fixture.db.message.findUniqueOrThrow({where: {id: reply.id}});
  assert.equal(updated.content, '原回复。续写内容。', 'continuation creates a selected version without duplicating the old text');
  const versions = await listMessageVersions(fixture.user.id, conversation.id, reply.id);
  assert.equal(versions.items.length, 2);
  const original = versions.items.find(row => row.content === '原回复。')!;
  await fixture.db.message.create({data: {conversationId: conversation.id, role: 'USER', content: 'later message'}});
  await chooseMessageVersion(fixture.user.id, conversation.id, reply.id, original.id);
  assert.equal((await fixture.db.message.findUniqueOrThrow({where: {id: reply.id}})).content, '原回复。');
  assert.equal(await fixture.db.message.count({where: {conversationId: conversation.id}}), 2, 'switching version removes subsequent history');
  const replay = await new Response((await generate()).stream).text();
  assert.ok(replay.includes('原回复。续写内容。'), 'same request replays its generated version even after selecting an earlier version');
  assert.equal(calls, 1);
  const use = await readContextUse(fixture.user.id, conversation.id);
  assert.ok(use);
  const {createMemoryFact} = await import('@rumiai/backend/modules/memory/fact-service');
  const fact = await createMemoryFact(fixture.user.id, conversation.id, {text: '我提到了青鸟', sourceMessageId: userMessage.id});
  const branch = await createConversationBranch(fixture.user.id, conversation.id, reply.id);
  assert.notEqual(branch.id, conversation.id);
  assert.equal(await fixture.db.message.count({where: {conversationId: branch.id}}), 2);
  const copiedFact = await fixture.db.memoryFact.findFirstOrThrow({where: {conversationId: branch.id}});
  assert.notEqual(copiedFact.sourceMessageId, userMessage.id, 'fork remaps source references to the copied messages');
  assert.equal(await fixture.db.generationCharge.count({where: {conversationId: branch.id}}), 0, 'fork never copies charges');
  await setMessageContextIncluded(fixture.user.id, conversation.id, userMessage.id, false);
  assert.equal((await fixture.db.memoryFact.findUniqueOrThrow({where: {id: fact.id}})).status, 'INVALID');
  await assert.rejects(() => createMemoryFact(fixture.user.id, branch.id, {text: 'wrong source', sourceMessageId: userMessage.id}), /来源消息/);
  await recordMessageFeedback(fixture.user.id, conversation.id, reply.id, 'REPETITIVE');
  await recordMessageFeedback(fixture.user.id, conversation.id, reply.id, 'REPETITIVE');
  assert.equal(await fixture.db.messageFeedback.count(), 1);
  const {updateConversation, readUserConversationPage} = await import('@rumiai/backend/modules/conversations/conversation-service');
  await updateConversation(fixture.user.id, conversation.id, {title: '自定义会话', pinned: true});
  assert.equal((await readUserConversationPage(fixture.user.id, {})).items[0].id, conversation.id);
  const {searchConversationMessages} = await import('@rumiai/backend/modules/conversations/search/service');
  assert.ok((await searchConversationMessages(fixture.user.id, '青鸟')).items.some(row => row.id === userMessage.id));
  assert.equal((await searchConversationMessages(fixture.admin.id, '青鸟')).items.length, 0);
  const {readMessageWindow} = await import('@rumiai/backend/modules/conversations/search/window');
  const window = await readMessageWindow(fixture.user.id, conversation.id, userMessage.id);
  assert.ok(window.messages.some(row => row.id === userMessage.id));
  await assert.rejects(() => readMessageWindow(fixture.admin.id, conversation.id, userMessage.id), /无权访问/);
  await deletePersona(fixture.user.id, persona.id);
  assert.equal((await fixture.db.conversation.findUniqueOrThrow({where: {id: conversation.id}})).personaId, null);
});
