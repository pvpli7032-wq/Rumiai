import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('ordinary chat sends confirmed memory in the real upstream system prompt', async t => {
  assert.equal(process.env.DATABASE_URL, undefined, 'fixture must own its database');
  const fixture = await createFixture();
  const previousFetch = globalThis.fetch;
  const keys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MAX_RETRIES'] as const;
  const previousEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    await fixture.cleanup();
  });
  process.env.OPENAI_API_KEY = 'fixture-only-no-paid-provider';
  process.env.OPENAI_BASE_URL = 'https://memory.example.test/v1';
  process.env.AI_MAX_RETRIES = '0';
  const requests: Array<{messages: Array<{role: string; content: string}>}> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.href, 'https://memory.example.test/v1/chat/completions', 'no external network request is permitted');
    requests.push(JSON.parse(String(init?.body)));
    return new Response([
      'data: {"choices":[{"delta":{"content":"fixture memory reply"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]', '', '',
    ].join('\n'), {headers: {'Content-Type': 'text/event-stream'}});
  };
  await fixture.db.operationSetting.create({data: {key: 'memory.enabled', group: 'growth', value: 'true', updatedBy: fixture.admin.id}});
  const character = await fixture.db.character.create({data: {name: 'memory-character', personality: 'fixture persona', background: 'fixture background', creatorId: fixture.user.id}});
  const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id}});
  await fixture.db.conversationMemory.create({data: {conversationId: conversation.id, summary: 'confirmed summary marker'}});
  await fixture.db.memoryFact.createMany({data: [
    {conversationId: conversation.id, userId: fixture.user.id, text: 'active fact marker', status: 'ACTIVE'},
    {conversationId: conversation.id, userId: fixture.user.id, text: 'invalid fact must not be injected', status: 'INVALID'},
  ]});
  const {executeChatTurn} = await import('@rumiai/backend/modules/conversations/chat-application-service');
  const result = await executeChatTurn({userId: fixture.user.id, conversationId: conversation.id, mode: 'SEND', input: {request: new Request('http://fixture.test/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: 'hello', requestId: 'memory-injection-fixture'})})}, signal: new AbortController().signal});
  const stream = await new Response(result.stream).text();
  assert.ok(stream.includes('fixture memory reply'));
  assert.equal(requests.length, 1);
  const system = requests[0].messages.find(message => message.role === 'system')?.content ?? '';
  assert.ok(system.includes('fixture persona'));
  assert.ok(system.includes('confirmed summary marker'));
  assert.ok(system.includes('active fact marker'));
  assert.ok(!system.includes('invalid fact must not be injected'));
  assert.equal(await fixture.db.message.count({where: {conversationId: conversation.id, role: 'ASSISTANT', content: 'fixture memory reply'}}), 1);
});
