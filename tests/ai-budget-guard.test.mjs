import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { budgetCircuitBreakerMode } from '../src/lib/ai/budget-config.ts';
import { estimateAiCallCost } from '../src/lib/ai/cost-accounting.ts';

const file = `ai-budget-guard-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = 'local-fixture-only';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
process.env.AI_PRICE_MODEL = 'fixture-model';
process.env.AI_PRICE_CURRENCY = 'USD';
process.env.AI_INPUT_PRICE_PER_MILLION = '2';
process.env.AI_OUTPUT_PRICE_PER_MILLION = '4';

// The Prisma schema engine cannot run in restricted environments (OS error 5);
// the repo convention is to apply migrations with node:sqlite instead.
const { createIsolatedDatabase } = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(path.resolve('prisma', file));
const { db, pragmasReady } = await import('../src/lib/db.ts'); await pragmasReady;
const { reserveAiCall, finishAiCall, AiQuotaError, quotaDay } = await import('../src/lib/ai/ai-usage.ts');
const { clearKeyEverywhere } = await import('../src/lib/settings/cache.ts');
/** 每日请求上限与频率窗口现在来自设置中心；测试按同一张表写入并清缓存。 */
async function setSetting(key, group, value) {
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group, value: JSON.stringify(value), version: 1, updatedBy: 'test-operator'},
    update: {value: JSON.stringify(value), version: {increment: 1}, updatedBy: 'test-operator'},
  });
  clearKeyEverywhere(key);
}
await setSetting('billing.hardDailyMessages', 'chat', 3);
await setSetting('limits.chat.perWindow', 'chat', 100);
const { readCostBudgetBlock } = await import('../src/lib/ai/budget-guard.ts');
const { signToken } = await import('../src/lib/auth.ts');
const { POST: send } = await import('../src/app/api/conversations/[id]/messages/route.ts');
const { POST: regenerate } = await import('../src/app/api/conversations/[id]/messages/[messageId]/regenerate/route.ts');
const a = await db.user.create({ data: { username: 'budget-a', email: 'budget-a@example.invalid', passwordHash: 'synthetic-only', coins: 73 } });
const b = await db.user.create({ data: { username: 'budget-b', email: 'budget-b@example.invalid', passwordHash: 'synthetic-only', coins: 41 } });
const role = await db.character.create({ data: { creatorId: a.id, name: '预算测试角色', personality: '本地测试', background: '本地测试' } });
const conversation = await db.conversation.create({ data: { userId: a.id, characterId: role.id } });
const warnings = [], originalWarn = console.warn;
console.warn = line => warnings.push(JSON.parse(line));
test.after(async () => {
  console.warn = originalWarn;
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), { force: true });
});
test.beforeEach(async () => {
  process.env.AI_BUDGET_CIRCUIT_BREAKER = 'true';
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":10,"user":1}}';
  await db.aiCall.deleteMany(); await db.aiDailyUsage.deleteMany(); warnings.length = 0;
});
const addCall = (data = {}) => db.aiCall.create({ data: { userId: a.id, conversationId: conversation.id, operation: 'SEND', currency: 'USD', status: 'SUCCEEDED', attempts: 1, estimatedCost: 1, startedAt: new Date(Date.now() - 1000), ...data } });
const blocked = async (operation = 'SEND', status = 429, code = 'AI_COST_BUDGET', userId = a.id) => {
  await assert.rejects(reserveAiCall(userId, conversation.id, operation), error => error instanceof AiQuotaError && error.status === status && error.block?.code === code);
};

test('single-attempt cost requires matching model and valid usage/prices; retries remain unknown', () => {
  const metrics = { model: 'fixture-model', attempts: 1, inputTokens: 100, outputTokens: 20 };
  assert.equal(estimateAiCallCost('SUCCEEDED', metrics), 0.00028);
  assert.equal(estimateAiCallCost('SUCCEEDED', { ...metrics, attempts: 2 }), null);
  assert.equal(estimateAiCallCost('FAILED', { model: 'fixture-model', attempts: 2 }), null);
  assert.equal(estimateAiCallCost('MOCK', {}), 0);
  for (const changed of [{ model: 'unpriced-model' }, { inputTokens: -1 }, { outputTokens: 1.5 }, { outputTokens: undefined }]) assert.equal(estimateAiCallCost('SUCCEEDED', { ...metrics, ...changed }), null);
  assert.equal(estimateAiCallCost('SUCCEEDED', metrics, { ...process.env, AI_INPUT_PRICE_PER_MILLION: '' }), null);
  assert.equal(estimateAiCallCost('SUCCEEDED', metrics, { ...process.env, AI_INPUT_PRICE_PER_MILLION: '1e308' }), null);
});

test('opt-in mode validates explicit values; disabled guard does not inspect the database', async () => {
  assert.equal(budgetCircuitBreakerMode(''), 'disabled'); assert.equal(budgetCircuitBreakerMode('false'), 'disabled');
  assert.equal(budgetCircuitBreakerMode(' true '), 'enabled'); assert.equal(budgetCircuitBreakerMode('yes'), 'invalid');
  process.env.AI_BUDGET_CIRCUIT_BREAKER = 'false'; process.env.AI_DAILY_COST_BUDGETS = '{';
  assert.equal(await readCostBudgetBlock({}, a.id, new Date(), 'USD'), null);
  const call = await reserveAiCall(a.id, conversation.id, 'SEND');
  assert.equal(quotaDay(call.startedAt), (await db.aiDailyUsage.findFirst()).day);
});

test('disabled cost guard retains the persistent daily cap under eight concurrent admissions', async () => {
  process.env.AI_BUDGET_CIRCUIT_BREAKER = 'false'; process.env.AI_DAILY_COST_BUDGETS = '';
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserveAiCall(a.id, conversation.id, 'SEND')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  const denied = results.filter(result => result.status === 'rejected');
  assert.equal(denied.length, 5);
  assert(denied.every(result => result.reason instanceof AiQuotaError && !result.reason.block));
  assert.equal((await db.aiDailyUsage.findFirst()).count, 3); assert.equal(await db.aiCall.count(), 3);
});

test('bad enabled configuration rejects before a call or daily slot commits', async () => {
  for (const raw of ['', '{', '{"CNY":{"site":1}}']) {
    process.env.AI_DAILY_COST_BUDGETS = raw;
    await blocked('SEND', 503, 'AI_BUDGET_CONFIGURATION');
    assert.equal(await db.aiCall.count(), 0); assert.equal(await db.aiDailyUsage.count(), 0);
  }
  process.env.AI_BUDGET_CIRCUIT_BREAKER = 'yes';
  await blocked('SEND', 503, 'AI_BUDGET_CONFIGURATION');
  process.env.AI_BUDGET_CIRCUIT_BREAKER = 'true'; process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1}}';
  const originalPrice = process.env.AI_INPUT_PRICE_PER_MILLION;
  try {
    for (const raw of ['', '-1', 'not-a-price']) {
      process.env.AI_INPUT_PRICE_PER_MILLION = raw;
      await blocked('SEND', 503, 'AI_BUDGET_CONFIGURATION');
      assert.equal(await db.aiDailyUsage.count(), 0);
    }
  } finally { process.env.AI_INPUT_PRICE_PER_MILLION = originalPrice; }
});

test('per-user threshold isolates accounts and excludes mocks, older days, future calls and other currencies', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"user":1}}';
  await addCall(); await blocked();
  await addCall({ userId: b.id, status: 'MOCK', estimatedCost: 100 });
  await addCall({ userId: b.id, startedAt: new Date(Date.now() - 86400000), estimatedCost: null });
  await addCall({ userId: b.id, startedAt: new Date(Date.now() + 86400000), estimatedCost: null });
  await addCall({ userId: b.id, currency: 'CNY', estimatedCost: 100 });
  await reserveAiCall(b.id, conversation.id, 'SEND');
  assert.equal(await db.aiDailyUsage.count({ where: { userId: a.id } }), 0);
  assert.equal((await db.aiDailyUsage.findFirst({ where: { userId: b.id } })).count, 1);
});

test('site threshold uses all accounts and concurrent refusals leave quota and coins unchanged', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1}}';
  await addCall({ estimatedCost: 0.5 }); await addCall({ userId: b.id, estimatedCost: 0.5 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserveAiCall(a.id, conversation.id, 'SEND')));
  assert(results.every(result => result.status === 'rejected' && result.reason instanceof AiQuotaError && result.reason.block?.code === 'AI_COST_BUDGET'));
  assert.equal(await db.aiCall.count(), 2); assert.equal(await db.aiDailyUsage.count(), 0);
  assert.equal((await db.user.findUnique({ where: { id: a.id } })).coins, 73);
  assert.equal((await db.user.findUnique({ where: { id: b.id } })).coins, 41);
});

test('queued admission evaluates costs committed after the request arrived', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1}}';
  let markHeld, releaseWriter, createCost;
  const held = new Promise(resolve => { markHeld = resolve; });
  const release = new Promise(resolve => { releaseWriter = resolve; });
  const create = new Promise(resolve => { createCost = resolve; });
  const writer = db.$transaction(async tx => {
    await tx.aiDailyUsage.create({ data: { userId: a.id, day: quotaDay(), count: 0 } });
    markHeld(); await create;
    await tx.aiCall.create({ data: { userId: b.id, conversationId: conversation.id, operation: 'SEND', currency: 'USD', status: 'SUCCEEDED', attempts: 1, estimatedCost: 1, startedAt: new Date() } });
    await release;
  });
  await held;
  const queued = reserveAiCall(a.id, conversation.id, 'SEND').then(call => ({ call }), error => ({ error }));
  try {
    await new Promise(resolve => setTimeout(resolve, 30)); createCost(); releaseWriter();
    await writer;
    const result = await queued;
    assert(result.error instanceof AiQuotaError && result.error.block?.code === 'AI_COST_BUDGET');
    assert.equal((await db.aiDailyUsage.findFirst({ where: { userId: a.id } })).count, 0);
    assert.equal(await db.aiCall.count(), 1);
  } finally { createCost(); releaseWriter(); await Promise.allSettled([writer, queued]); }
});

test('unknown completed costs and old multi-attempt partial estimates stop the configured scope', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"user":1}}';
  await addCall({ estimatedCost: null, status: 'FAILED' });
  await blocked('SEND', 429, 'AI_COST_UNKNOWN');
  await reserveAiCall(b.id, conversation.id, 'SEND');
  await db.aiCall.deleteMany(); await db.aiDailyUsage.deleteMany();
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":10}}';
  await addCall({ userId: b.id, estimatedCost: 0.01, attempts: 2 });
  await blocked('REGENERATE', 429, 'AI_COST_UNKNOWN');
});

test('UTC day rollover reopens admission; in-flight calls are not claimed as a reserved money cap', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1}}';
  await addCall({ startedAt: new Date('2026-10-12T23:59:59.000Z') });
  const check = now => db.$transaction(tx => readCostBudgetBlock(tx, a.id, new Date(now), 'USD'));
  assert.equal((await check('2026-10-12T23:59:59.999Z')).code, 'AI_COST_BUDGET');
  assert.equal(await check('2026-10-13T00:00:00.000Z'), null);
  await db.aiCall.deleteMany();
  const calls = await Promise.all([reserveAiCall(a.id, conversation.id, 'SEND'), reserveAiCall(a.id, conversation.id, 'REGENERATE')]);
  assert.equal(calls.length, 2); assert.equal(await db.aiCall.count({ where: { status: 'STARTED' } }), 2);
});

test('completion persists costs and emits private-safe warnings; retry completion records unknown cost', async () => {
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":0.00028}}';
  const call = await reserveAiCall(a.id, conversation.id, 'SEND');
  const finished = await finishAiCall(call.id, call.startedAt, 'SUCCEEDED', { model: 'fixture-model', attempts: 1, inputTokens: 100, outputTokens: 20 });
  assert.equal(finished.estimatedCost, 0.00028);
  assert(warnings.some(row => row.message === 'ai_budget_alert' && row.code === 'AI_COST_BUDGET' && row.callId === call.id));
  await blocked();
  const serialized = JSON.stringify(warnings);
  assert(!serialized.includes(a.email)); assert(!serialized.includes('local-fixture-only')); assert(!serialized.includes('synthetic-only'));
  await db.aiCall.deleteMany(); await db.aiDailyUsage.deleteMany(); warnings.length = 0;
  const retry = await reserveAiCall(a.id, conversation.id, 'SEND');
  const retried = await finishAiCall(retry.id, retry.startedAt, 'SUCCEEDED', { model: 'fixture-model', attempts: 2, inputTokens: 100, outputTokens: 20 });
  assert.equal(retried.estimatedCost, null);
  assert(warnings.some(row => row.message === 'ai_budget_alert' && row.code === 'AI_COST_UNKNOWN'));
});

test('send and regenerate return budget refusal without upstream calls or changing messages', async () => {
  const before = new Date(Date.now() - 2000);
  const prompt = await db.message.create({ data: { conversationId: conversation.id, role: 'USER', content: 'SYNTHETIC_PRIVATE_PROMPT', createdAt: before } });
  const reply = await db.message.create({ data: { conversationId: conversation.id, role: 'ASSISTANT', content: 'SYNTHETIC_PRIVATE_REPLY', createdAt: new Date(before.getTime() + 1000) } });
  await addCall();
  const token = await signToken({ userId: a.id, email: a.email, tokenVersion: a.tokenVersion });
  let upstreamCalls = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalls++; throw Error('Unexpected upstream request'); };
  try {
    const request = data => new Request('http://localhost/api/conversations/fixture', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const deniedSend = await send(request({ content: 'Must not persist' }), { params: Promise.resolve({ id: conversation.id }) });
    const deniedRegenerate = await regenerate(request({}), { params: Promise.resolve({ id: conversation.id, messageId: reply.id }) });
    for (const response of [deniedSend, deniedRegenerate]) { assert.equal(response.status, 429); assert(Number(response.headers.get('Retry-After')) > 0); }
    process.env.AI_DAILY_COST_BUDGETS = '{';
    const invalidConfig = await send(request({ content: 'Must not persist either' }), { params: Promise.resolve({ id: conversation.id }) });
    assert.equal(invalidConfig.status, 503); assert.equal(invalidConfig.headers.get('Retry-After'), null);
    assert.equal(upstreamCalls, 0); assert.equal(await db.message.count(), 2);
    assert.equal((await db.message.findUnique({ where: { id: reply.id } })).content, 'SYNTHETIC_PRIVATE_REPLY');
    assert.equal(await db.aiCall.count(), 1); assert.equal(await db.aiDailyUsage.count(), 0);
    assert(!JSON.stringify(warnings).includes(prompt.content));
  } finally { globalThis.fetch = originalFetch; }
});

test('monitor read failure does not undo the completed cost record', async () => {
  const call = await reserveAiCall(a.id, conversation.id, 'SEND');
  const originalTransaction = db.$transaction;
  db.$transaction = async () => { throw Error('Synthetic monitor failure'); };
  try {
    const finished = await finishAiCall(call.id, call.startedAt, 'SUCCEEDED', { model: 'fixture-model', attempts: 1, inputTokens: 100, outputTokens: 20 });
    assert.equal(finished.status, 'SUCCEEDED'); assert.equal(finished.estimatedCost, 0.00028);
    assert.equal((await db.aiCall.findUnique({ where: { id: call.id } })).status, 'SUCCEEDED');
    assert(warnings.some(row => row.message === 'ai_budget_monitor_failed' && row.callId === call.id));
  } finally { db.$transaction = originalTransaction; }
});
