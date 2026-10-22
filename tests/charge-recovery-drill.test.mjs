import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * V3 §8 表 25「一次中断恢复；已保存消息可结算；未知结果不盲目退款或重发」的可重复验收演练。
 * 每个场景都是「进程在生成中断掉」的真实残局：费用单停在 HELD，权威状态散在 story_turns /
 * ai_calls / messages 里。断言打在 generation_charges 状态、coin_transactions 流水条数与
 * user_daily_allowances 的 free_used / free_reserved 上，不看函数返回值。
 * 每场景独立用户 + 独立 requestId，共用一个隔离库，按 (user, operation, requestId) 定位。
 */

const file = `charge-recovery-${process.pid}-${Date.now()}.db`;
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
process.env.AI_PROVIDER_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);

const {db} = await import('../src/lib/db.ts');
const {holdCharge} = await import('../src/lib/billing/charge-service.ts');
const {reconcileHeldCharges} = await import('../src/lib/billing/recovery.ts');
const {readDailyAllowance} = await import('../src/lib/billing/allowance.ts');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');
const {encryptProviderSecret} = await import('../src/lib/ai/providers/secret.ts');
const {executeChatTurn} = await import('../src/lib/conversations/chat-application-service.ts');

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 走设置中心同一条写入路径：version 递增后读侧立即拿到新值。 */
async function setSetting(key, value) {
  const current = await db.operationSetting.findUnique({where: {key}});
  const version = (current?.version ?? 0) + 1;
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group: 'billing', value: JSON.stringify(value), version, updatedBy: 'test-operator'},
    update: {value: JSON.stringify(value), version, updatedBy: 'test-operator'},
  });
  const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
  clearKeyEverywhere(key);
}

/** 故事回合按 story.coinPrice 计价，不需要模型与供应商；聊天价则必须有模型币价。 */
const STORY_PRICE = 20;

async function fixture(coins) {
  const name = randomUUID();
  const user = await db.user.create({data: {username: `drill_${name.slice(0, 8)}`, email: `drill-${name}@example.invalid`, passwordHash: 'synthetic', coins}});
  const character = await db.character.create({data: {creatorId: user.id, name: '演练角色', personality: '平静', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id}});
  return {user, character, conversation};
}

/** 一个已存在的故事实例：recovery 按 requestId + run.conversationId 找回合的权威状态。 */
async function storyRunFor(user, character, conversation) {
  const template = await db.storyTemplate.create({data: {slug: 'drill-' + randomUUID().slice(0, 8), title: '演练故事', status: 'PUBLISHED'}});
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '介绍', chapters: [{key: 'opening', title: '开场'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const {run} = await createStoryRun(user.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  await db.storyRun.update({where: {id: run.id}, data: {conversationId: conversation.id}});
  return run;
}

const balanceOf = async user => (await db.user.findUnique({where: {id: user.id}, select: {coins: true}})).coins;
const chargeOf = (user, requestId) => db.generationCharge.findUnique({where: {userId_operation_requestId: {userId: user.id, operation: 'STORY_TURN', requestId}}});
const ledgerOf = chargeId => db.coinTransaction.findMany({where: {chargeId}, select: {amount: true, chargeAction: true, sourceKey: true}});
const backdate = (chargeId, ms) => db.generationCharge.update({where: {id: chargeId}, data: {heldAt: new Date(Date.now() - ms)}});
const allowanceOf = async userId => { const {freeUsed, freeReserved} = await readDailyAllowance(userId); return {freeUsed, freeReserved}; };
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

test('中断恢复（已保存消息）：提交过的回合补结算，币只扣一次、不重复扣', async () => {
  await setSetting('billing.chargingEnabled', true);
  await setSetting('billing.freeDailyMessages', 0);
  await setSetting('story.chargingEnabled', true);
  await setSetting('story.coinPrice', STORY_PRICE);
  const {user, character, conversation} = await fixture(100);
  const run = await storyRunFor(user, character, conversation);
  const requestId = randomUUID();

  // 进程在「已预扣、回合已提交、还没结算」之间断掉。
  const hold = await holdCharge({userId: user.id, requestId, operation: 'STORY_TURN', conversationId: conversation.id});
  assert.equal(hold.status, 'HELD');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, '预扣已从余额扣掉');
  const assistant = await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: '已经保存的回复'}});
  await db.storyTurn.create({data: {
    runId: run.id, turnNo: 1, requestId, requestHash: 'hash-' + requestId, operation: 'TURN',
    status: 'COMMITTED', committedAt: new Date(), assistantMessageId: assistant.id, startedAt: new Date(),
  }});
  await backdate(hold.chargeId, 30 * MINUTE);

  const report = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(report.outcomes.find(outcome => outcome.chargeId === hold.chargeId)?.decision, 'SETTLED');

  const charge = await chargeOf(user, requestId);
  assert.equal(charge.status, 'SETTLED', '已保存消息 → 结算');
  assert.equal(charge.coins, STORY_PRICE);
  assert.equal(charge.messageId, assistant.id, '费用单挂上已保存的那条回复');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, '结算不再扣一次余额');

  const ledger = await ledgerOf(hold.chargeId);
  assert.equal(ledger.length, 1, '只有一条预扣流水，结算只是归账');
  assert.deepEqual([ledger[0].amount, ledger[0].chargeAction, ledger[0].sourceKey], [-STORY_PRICE, 'HOLD', 'CHAT_SPEND'], '预扣流水归为聊天消费');
  assert.equal(ledger.filter(row => row.amount > 0).length, 0, '结算不产生正数流水');

  // 再核对一轮：已结算的单据不在扫描范围，不会重复结算或补扣。
  const again = await reconcileHeldCharges({holdTimeoutMinutes: 0});
  assert.equal(again.outcomes.some(outcome => outcome.chargeId === hold.chargeId), false);
  assert.equal(await balanceOf(user), 100 - STORY_PRICE);
  assert.equal((await ledgerOf(hold.chargeId)).length, 1);
});

test('中断恢复（没有已保存消息）：付费单退回余额、免费额度退回预占，各只退一次', async () => {
  await setSetting('billing.chargingEnabled', true);
  await setSetting('story.chargingEnabled', true);
  await setSetting('story.coinPrice', STORY_PRICE);

  // a) 付费单：调用确认失败且没有保存消息 → 释放。
  const paid = await fixture(100);
  const paidRun = await storyRunFor(paid.user, paid.character, paid.conversation);
  const paidId = randomUUID();
  const paidHold = await holdCharge({userId: paid.user.id, requestId: paidId, operation: 'STORY_TURN', conversationId: paid.conversation.id});
  const failedTurn = await db.storyTurn.create({data: {
    runId: paidRun.id, turnNo: 1, requestId: paidId, requestHash: 'hash-' + paidId, operation: 'TURN',
    status: 'FAILED', errorCode: 'UPSTREAM_ERROR', startedAt: new Date(),
  }});
  assert.equal(failedTurn.status, 'FAILED');
  await backdate(paidHold.chargeId, 30 * MINUTE);

  const paidReport = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(paidReport.outcomes.find(outcome => outcome.chargeId === paidHold.chargeId)?.decision, 'RELEASED');
  assert.equal((await chargeOf(paid.user, paidId)).status, 'RELEASED');
  assert.equal(await balanceOf(paid.user), 100, '预扣全额退回');
  const paidLedger = await ledgerOf(paidHold.chargeId);
  assert.equal(paidLedger.length, 2);
  assert.equal(paidLedger.filter(row => row.amount > 0).length, 1, '只有一条正数返还流水');
  const refund = paidLedger.find(row => row.amount > 0);
  assert.deepEqual([refund.amount, refund.chargeAction, refund.sourceKey], [STORY_PRICE, 'RELEASE', 'CHAT_RELEASE']);

  // b) 免费额度单：预占还回去，free_used 不动（这次没消耗）。
  await setSetting('billing.freeDailyMessages', 1);
  const free = await fixture(0);
  const freeRun = await storyRunFor(free.user, free.character, free.conversation);
  const freeId = randomUUID();
  const freeHold = await holdCharge({userId: free.user.id, requestId: freeId, operation: 'STORY_TURN', conversationId: free.conversation.id});
  assert.equal(freeHold.allowanceSource, 'FREE_QUOTA', '占用的是免费次数而不是余额');
  assert.equal(freeHold.coins, 0);
  assert.deepEqual(await allowanceOf(free.user.id), {freeUsed: 0, freeReserved: 1});
  await db.storyTurn.create({data: {
    runId: freeRun.id, turnNo: 1, requestId: freeId, requestHash: 'hash-' + freeId, operation: 'TURN',
    status: 'FAILED', errorCode: 'UPSTREAM_ERROR', startedAt: new Date(),
  }});
  await backdate(freeHold.chargeId, 30 * MINUTE);

  const freeReport = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(freeReport.outcomes.find(outcome => outcome.chargeId === freeHold.chargeId)?.decision, 'RELEASED');
  assert.deepEqual(await allowanceOf(free.user.id), {freeUsed: 0, freeReserved: 0}, '预占释放回原状，免费次数没被消耗');
  assert.equal(await balanceOf(free.user), 0);
  assert.equal((await ledgerOf(freeHold.chargeId)).length, 0, '免费额度不动币流水');
});

test('中断恢复（结果不明）：落 UNKNOWN 挂账，不盲目退款也不重发', async () => {
  await setSetting('billing.chargingEnabled', true);
  // 上一个用例把免费次数设成 1：这里要的是付费单，先关掉免费额度。
  await setSetting('billing.freeDailyMessages', 0);
  await setSetting('story.chargingEnabled', true);
  await setSetting('story.coinPrice', STORY_PRICE);
  const {user, character, conversation} = await fixture(100);
  const run = await storyRunFor(user, character, conversation);
  const requestId = randomUUID();

  // 模型调用成功、但回合没提交、也没有保存消息：权威结果不明。
  const hold = await holdCharge({userId: user.id, requestId, operation: 'STORY_TURN', conversationId: conversation.id});
  const call = await db.aiCall.create({data: {userId: user.id, conversationId: conversation.id, operation: 'SEND', status: 'SUCCEEDED', currency: 'USD', finishedAt: new Date()}});
  await db.generationCharge.update({where: {id: hold.chargeId}, data: {aiCallId: call.id}});
  await db.storyTurn.create({data: {
    runId: run.id, turnNo: 1, requestId, requestHash: 'hash-' + requestId, operation: 'TURN',
    status: 'UNKNOWN', startedAt: new Date(),
  }});
  await backdate(hold.chargeId, 30 * MINUTE);

  // 刚过冻结窗：保持待核对，既不结算也不释放。
  const first = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(first.outcomes.find(outcome => outcome.chargeId === hold.chargeId)?.decision, 'KEPT');
  assert.equal((await chargeOf(user, requestId)).status, 'HELD');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, '不自动退款');

  // 超过两天仍无权威结果：转 UNKNOWN 挂账，等人处理。
  await backdate(hold.chargeId, 3 * DAY);
  const second = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(second.outcomes.find(outcome => outcome.chargeId === hold.chargeId)?.decision, 'UNKNOWN');
  const charge = await chargeOf(user, requestId);
  assert.equal(charge.status, 'UNKNOWN');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, 'UNKNOWN 不自动退款');
  const ledger = await ledgerOf(hold.chargeId);
  assert.equal(ledger.length, 1, 'UNKNOWN 不写返还流水');
  assert.equal(ledger.filter(row => row.amount > 0).length, 0);
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 0, '不重发、不补写消息');
  assert.equal(await db.aiCall.count({where: {userId: user.id}}), 1, '不重新发起模型调用');

  // 再核对：UNKNOWN 不在扫描范围，永远不会被改成 SETTLED 或 RELEASED。
  const third = await reconcileHeldCharges({holdTimeoutMinutes: 0});
  assert.equal(third.outcomes.some(outcome => outcome.chargeId === hold.chargeId), false);
  assert.equal((await chargeOf(user, requestId)).status, 'UNKNOWN');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE);
});

/** 聊天夹具：一个带币价的默认模型 + 绑定到角色（否则运行时模型计划为空）。 */
async function chatFixture() {
  await setSetting('billing.chargingEnabled', true);
  await setSetting('billing.freeDailyMessages', 0);
  const name = randomUUID();
  const user = await db.user.create({data: {username: `drill_chat_${name.slice(0, 8)}`, email: `drill-chat-${name}@example.invalid`, passwordHash: 'synthetic', coins: 100}});
  const character = await db.character.create({data: {creatorId: user.id, name: '聊天演练角色', personality: '平静', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id}});
  // 聊天价来自模型币价（故事价只作用于 STORY_TURN）。
  const provider = await db.aiProvider.create({data: {name: '演练供应商-' + name.slice(0, 6), baseUrl: 'https://models.example.invalid/v1', isActive: true, ...encryptProviderSecret('drill-key')}});
  await db.aiModel.updateMany({where: {isDefault: true}, data: {isDefault: false}});
  const model = await db.aiModel.create({data: {key: 'drill-model-' + name.slice(0, 6), displayName: '演练模型', modelCode: 'provider-chat', providerId: provider.id, isActive: true, isDefault: true, sortOrder: -9999}});
  await db.modelCoinPrice.create({data: {modelId: model.id, coinsPerReply: STORY_PRICE, effectiveAt: new Date(Date.now() - 60_000), createdBy: 'test-operator'}});
  await db.characterAiModel.create({data: {characterId: character.id, modelKey: model.key}});
  return {user, character, conversation, model};
}

const chatRequest = (conversationId, requestId, content = '你好') => new Request('http://local/api/conversations/' + conversationId + '/messages', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content, requestId}),
});

/** 上游用可控 SSE 代替真实供应商：计费只看结果，不依赖外网。 */
async function withStubbedUpstream(run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"呀"},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n',
    {status: 200, headers: {'Content-Type': 'text/event-stream'}},
  );
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}
const chatChargeOf = (user, requestId) => db.generationCharge.findUnique({where: {userId_operation_requestId: {userId: user.id, operation: 'CHAT_SEND', requestId}}});

test('聊天正常路径：消息保存与结算同一个事务，单据 SETTLED 且回填 messageId 与 aiCallId', async () => {
  const {user, conversation} = await chatFixture();
  const requestId = randomUUID();
  const text = await withStubbedUpstream(async () => new Response((await executeChatTurn({userId: user.id, conversationId: conversation.id, mode: 'SEND', input: {request: chatRequest(conversation.id, requestId)}, signal: new AbortController().signal})).stream).text());
  assert.match(text, /[DONE]/);

  const charge = await chatChargeOf(user, requestId);
  assert.equal(charge.status, 'SETTLED');
  assert.equal(charge.coins, STORY_PRICE);
  const saved = await db.message.findFirst({where: {conversationId: conversation.id, role: 'ASSISTANT'}});
  assert.ok(saved, '回复已保存');
  assert.equal(charge.messageId, saved.id, 'messageId 已回填到费用单');
  assert.ok(charge.aiCallId, 'aiCallId 已回填到费用单');
  assert.ok(await db.aiCall.findUnique({where: {id: charge.aiCallId}}), '回填的 aiCallId 指向真实调用记录');
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, '只扣一次');
  assert.equal((await ledgerOf(charge.id)).filter(row => row.amount > 0).length, 0);
});

test('中断恢复（聊天事务原子性）：结算失败时消息也不落库，费用单仍 HELD，核对按没有已保存消息释放', async () => {
  const {user, conversation} = await chatFixture();
  const requestId = randomUUID();
  // 让事务里「结算」那一步失败：拦截 generation_charges 的任何 UPDATE（结算与释放都要写它）。
  await db.$executeRawUnsafe("CREATE TRIGGER drill_block_charge_write BEFORE UPDATE ON generation_charges BEGIN SELECT RAISE(ABORT, 'drill: 结算写入被拦截'); END");

  let text = '';
  try {
    text = await withStubbedUpstream(async () => new Response((await executeChatTurn({userId: user.id, conversationId: conversation.id, mode: 'SEND', input: {request: chatRequest(conversation.id, requestId)}, signal: new AbortController().signal})).stream).text());
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS drill_block_charge_write');
  }
  assert.match(text, /error/, '这一轮按保存失败收尾');

  // 关键：保存与结算同一个事务 —— 结算抛错，消息跟着回滚，不会留下「消息在、单据 HELD」。
  assert.equal(await db.message.count({where: {conversationId: conversation.id, role: 'ASSISTANT'}}), 0, '回复没有落库');
  const held = await chatChargeOf(user, requestId);
  assert.equal(held.status, 'HELD', '单据仍是 HELD，不是 SETTLED');
  assert.equal(held.messageId, null);
  assert.equal(await balanceOf(user), 100 - STORY_PRICE, '预扣还挂着，等核对处理');
  assert.equal((await ledgerOf(held.id)).length, 1, '只有预扣那一条流水');

  // 核对：确实没有已保存消息，判 RELEASED 是对的（不是白送）。
  await backdate(held.id, 3 * DAY);
  const report = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(report.outcomes.find(outcome => outcome.chargeId === held.id)?.decision, 'RELEASED');
  assert.equal((await chatChargeOf(user, requestId)).status, 'RELEASED');
  assert.equal(await balanceOf(user), 100, '预扣全额退回');
  const ledger = await ledgerOf(held.id);
  assert.equal(ledger.filter(row => row.amount > 0).length, 1, '只有一条返还流水');
});

