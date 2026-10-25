import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('relationship rules reach the upstream request and successful reply growth is idempotent', async t => {
  assert.equal(process.env.DATABASE_URL, undefined, 'fixture owns database');
  const fixture = await createFixture();
  const previousFetch = globalThis.fetch;
  const keys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MAX_RETRIES'] as const;
  const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const key of keys) {if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];}
    await fixture.cleanup();
  });
  process.env.OPENAI_API_KEY = 'fixture-only-no-paid-provider';
  process.env.OPENAI_BASE_URL = 'https://relationship.example.test/v1';
  process.env.AI_MAX_RETRIES = '0';
  const requests: Array<{messages: Array<{role: string; content: string}>}> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://relationship.example.test/v1/chat/completions');
    requests.push(JSON.parse(String(init?.body)));
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"fixture relationship reply\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", {headers: {'Content-Type': 'text/event-stream'}});
  };
  await fixture.db.operationSetting.createMany({data: [
    {key: 'relationship.romanceLevels', group: 'chat', value: JSON.stringify([{name: '认识', from: 0}, {name: '熟悉', from: 5}]), updatedBy: fixture.admin.id},
    {key: 'relationship.intimacyLevels', group: 'chat', value: '[]', updatedBy: fixture.admin.id},
    {key: 'relationship.romancePerReply', group: 'chat', value: '2', updatedBy: fixture.admin.id},
    {key: 'relationship.intimacyPerReply', group: 'chat', value: '3', updatedBy: fixture.admin.id},
    {key: 'prompt.relationshipMode', group: 'prompts', value: JSON.stringify('关系模式测试标记'), updatedBy: fixture.admin.id},
  ]});
  const character = await fixture.db.character.create({data: {name: 'relationship-character', personality: 'fixture persona', background: 'fixture', creatorId: fixture.user.id}});
  const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id, relationshipMode: true}});
  const {executeChatTurn} = await import('@rumiai/backend/modules/conversations/chat-application-service');
  async function send(requestId: string, content = 'hello') {
    const result = await executeChatTurn({userId: fixture.user.id, conversationId: conversation.id, mode: 'SEND',
      input: {request: new Request('http://fixture.test/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content, requestId})})},
      signal: new AbortController().signal});
    return new Response(result.stream).text();
  }
  await send('relationship-first');
  const system = requests[0].messages.find(message => message.role === 'system')?.content ?? '';
  assert.ok(system.includes('关系模式测试标记'));
  assert.ok(system.includes('当前浪漫等级：认识'));
  const grown = await fixture.db.conversation.findUniqueOrThrow({where: {id: conversation.id}});
  assert.equal(grown.romance, 2);
  assert.equal(grown.intimacy, 3);
  assert.equal(await fixture.db.conversationRelationshipEvent.count({where: {conversationId: conversation.id}}), 1);
  await send('relationship-first');
  assert.equal(requests.length, 1, 'request replay must not call upstream');
  assert.equal(await fixture.db.conversationRelationshipEvent.count({where: {conversationId: conversation.id}}), 1);
  const {readRelationshipPolicy, recordRelationshipGrowth} = await import('@rumiai/backend/modules/conversations/relationship-service');
  const policy = await readRelationshipPolicy();
  const event = await fixture.db.conversationRelationshipEvent.findFirstOrThrow({where: {conversationId: conversation.id}});
  await fixture.db.$transaction(tx => recordRelationshipGrowth(tx, {conversationId: conversation.id, requestId: event.requestId, messageId: event.messageId!}, policy));
  assert.equal((await fixture.db.conversation.findUniqueOrThrow({where: {id: conversation.id}})).romance, 2);
  await fixture.db.conversation.update({where: {id: conversation.id}, data: {relationshipMode: false}});
  await send('relationship-off');
  assert.ok(!requests[1].messages.some(message => message.role === 'system' && message.content.includes('关系模式测试标记')));
  assert.equal(await fixture.db.conversationRelationshipEvent.count({where: {conversationId: conversation.id}}), 1);
  await assert.rejects(() => send('relationship-first', 'different content'), /编号|标识/);
  const {holdCharge} = await import('@rumiai/backend/modules/billing/charge-service');
  const {settleCancellation} = await import('@rumiai/backend/modules/billing/cancel');
  const beforeCoins = (await fixture.db.user.findUniqueOrThrow({where: {id: fixture.user.id}})).coins;
  const beforeAllowance = await fixture.db.userDailyAllowance.findMany({where: {userId: fixture.user.id}});
  const held = await holdCharge({userId: fixture.user.id, conversationId: conversation.id, operation: 'CHAT_SEND', requestId: 'relationship-free-cancel', requestContent: 'cancel fixture'});
  assert.equal(held.held, true, 'free chat needs a durable request receipt');
  assert.equal(held.coins, 0);
  assert.equal(held.allowanceSource, 'FREE_MODE');
  await settleCancellation({userId: fixture.user.id, requestId: 'relationship-free-cancel', operation: 'CHAT_SEND', outputDelivered: true});
  const released = await fixture.db.generationCharge.findUniqueOrThrow({where: {userId_operation_requestId: {userId: fixture.user.id, operation: 'CHAT_SEND', requestId: 'relationship-free-cancel'}}});
  assert.equal(released.status, 'RELEASED');
  assert.equal((await fixture.db.user.findUniqueOrThrow({where: {id: fixture.user.id}})).coins, beforeCoins);
  assert.deepEqual(await fixture.db.userDailyAllowance.findMany({where: {userId: fixture.user.id}}), beforeAllowance, 'free mode cancellation must not consume quota or cancellation allowance');
  const {saveChanges} = await import('@rumiai/backend/modules/settings/service');
  await assert.rejects(() => saveChanges({changes: [{key: 'relationship.romanceLevels', value: [{name: '重复', from: 10}, {name: '错误', from: 1}]}], expectedVersions: {}, operatorId: fixture.admin.id}), /递增/);
  const {updateConversation} = await import('@rumiai/backend/modules/conversations/conversation-service');
  await assert.rejects(() => updateConversation(fixture.user.id, conversation.id, {romance: 999999}), /成长|修改|数值|积分/);
});
