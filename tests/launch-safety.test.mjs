import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maySimulatePurchase, mayUseMockChat, isAiChatAvailable } from '../src/lib/launch-guards.ts';

const env = (NODE_ENV, props={}) => ({NODE_ENV,...props});

test('M0: production blocks simulated top-ups even with an unsafe override', () => {
  assert.equal(maySimulatePurchase(env('production')), false);
  assert.equal(maySimulatePurchase(env('production',{ALLOW_SIMULATED_PURCHASES:'true'})), false);
  assert.equal(maySimulatePurchase(env('development')), false);
  assert.equal(maySimulatePurchase(env('development',{ALLOW_SIMULATED_PURCHASES:'false'})), false);
  assert.equal(maySimulatePurchase(env('development',{ALLOW_SIMULATED_PURCHASES:'true'})), true);
});

test('M0: production never generates scripted AI replies', () => {
  assert.equal(mayUseMockChat(env('production')), false);
  assert.equal(mayUseMockChat(env('production',{DISABLE_MOCK_AI:'false'})), false);
  assert.equal(mayUseMockChat(env('development',{DISABLE_MOCK_AI:'true'})), false);
  assert.equal(mayUseMockChat(env('development')), true);
});

test('M0: chat readiness requires a real key when mock is prohibited', () => {
  assert.equal(isAiChatAvailable(env('production')), false);
  assert.equal(isAiChatAvailable(env('production',{OPENAI_API_KEY:'test-key'})), true);
  assert.equal(isAiChatAvailable(env('development',{DISABLE_MOCK_AI:'true'})), false);
  assert.equal(isAiChatAvailable(env('development',{DISABLE_MOCK_AI:'true',OPENAI_API_KEY:'key'})), true);
});

test('M0: chat turn orchestration applies guards, and the regenerate transaction preserves old replies on failure', () => {
  const coin = fs.readFileSync('src/app/api/coins/purchase/route.ts','utf8');
  // 编排已从两个路由抽到 chat-application-service（规划书补丁 B），守卫断言随实现移动，
  // 路由侧只保留「不得自己编排」的反向断言。
  const chat = fs.readFileSync('src/app/api/conversations/[id]/messages/route.ts','utf8');
  const regen = fs.readFileSync('src/app/api/conversations/[id]/messages/[messageId]/regenerate/route.ts','utf8');
  const turn = fs.readFileSync('src/lib/conversations/chat-application-service.ts','utf8');
  const messageService = fs.readFileSync('src/lib/conversations/message-service.ts','utf8');
  const ui = fs.readFileSync('src/app/(app)/chat/page.tsx','utf8');
  assert.match(coin,/simulateCoinPurchase\(authUser\.userId/);
  assert.doesNotMatch(coin,/maySimulatePurchase|coinTransaction\.create|coinPackage\.find/);
  assert.match(turn,/const modelPlan = await readAiModelPlan\(conversation\.aiModel, conversation\.characterId\)/);
  assert.match(turn,/modelPlan === null \? await readActiveAiProviders\(\) : \[\]/);
  assert.match(turn,/isAiChatAvailable\(\{\.\.\.process\.env, OPENAI_API_KEY: usingRealAi \?/);
  assert.match(turn,/await replaceMessageReply\(input\.conversationId, replaceAt!, assistantContent\)/);
  assert.doesNotMatch(regen,/db\.(message|conversation)\.(create|update|deleteMany)/);
  assert.doesNotMatch(chat,/db\.(message|conversation)\.(create|update|deleteMany)/);
  assert.match(chat,/executeChatTurn\(\{userId: authUser\.userId, conversationId: params\.id, mode: 'SEND'/);
  assert.match(regen,/executeChatTurn\(\{userId: authUser\.userId, conversationId: params\.id, mode: 'REGENERATE'/);
  assert.ok(messageService.indexOf('if (!content.trim()) return null') < messageService.indexOf('return db.$transaction(async tx => {\n    await tx.message.deleteMany'));
  assert.match(ui,/if \(event\.error\) throw new Error\(event\.error\)/);
  assert.match(ui,/role="alert"/);
});

test('M0: original MIT license file is retained unchanged as to its contents', () => {
  const license = fs.readFileSync('LICENSE','utf8');
  assert.match(license,/MIT License/);
  assert.match(license,/Copyright \(c\) 2026 Khui AI Authors & Contributors/);
});