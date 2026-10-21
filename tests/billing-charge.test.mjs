import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `billing-charge-${process.pid}-${Date.now()}.db`;
// 仓库约定：用 node:sqlite 按顺序执行迁移，避开 Prisma schema engine 在受限环境里的失败。
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'false';
// 供应商密钥用真实加解密：运行时模型计划会解密它，缺 key 时该模型会被静默丢弃。
process.env.AI_PROVIDER_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);

const {db} = await import('../src/lib/db.ts');
const {applyPriceMultiplier, quoteReplyPrice} = await import('../src/lib/billing/price.ts');
const {resolveBillingDay, resolveBillingDayBoundary, readDailyAllowance} = await import('../src/lib/billing/allowance.ts');
const {holdCharge, settleCharge, releaseCharge, markChargeUnknown, readCharge, InsufficientCoinsError, ChargeRequestConflictError} = await import('../src/lib/billing/charge-service.ts');
const {reconcileHeldCharges, readPendingChargeSummary} = await import('../src/lib/billing/recovery.ts');
const {settleCancellation, readCancelPolicy} = await import('../src/lib/billing/cancel.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {GET: readQuota} = await import('../src/app/api/me/quota/route.ts');
const {encryptProviderSecret} = await import('../src/lib/ai/providers/secret.ts');
const {executeChatTurn} = await import('../src/lib/conversations/chat-application-service.ts');
const {executeStoryTurn} = await import('../src/lib/stories/turn-service.ts');
const {createStoryRun} = await import('../src/lib/stories/repository/run-service.ts');

test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

/** 后台保存一项设置：走设置中心同一条写入路径（version 递增），读侧会立即拿到新值。 */
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
async function removeSetting(key) {
  await db.operationSetting.deleteMany({where: {key}});
  const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
  clearKeyEverywhere(key);
}

async function billingFixture(options = {}) {
  const name = randomUUID();
  const user = await db.user.create({data: {username: `bill_${name.slice(0, 8)}`, email: `bill-${name}@example.invalid`, passwordHash: 'synthetic', coins: options.coins ?? 500}});
  const conversation = await db.conversation.create({data: {userId: user.id, characterId: (await db.character.create({data: {creatorId: user.id, name: '计费角色', personality: '平静', background: '', isPublic: true, reviewStatus: 'APPROVED'}})).id}});
  return {user, conversation};
}

/** 建一个带币价的模型：默认启用，coinsPerReply = coins。 */
let modelSeq = 0;
async function pricedModel(coins) {
  modelSeq += 1;
  const suffix = randomUUID().slice(0, 8);
  const provider = await db.aiProvider.create({data: {name: '测试供应商-' + suffix, baseUrl: 'https://models.example.invalid/v1', isActive: true, ...encryptProviderSecret('test-provider-key')}});
  // 每个用例只留一个默认模型，避免上一轮用例的模型抢到定价。
  await db.aiModel.updateMany({where: {isDefault: true}, data: {isDefault: false}});
  const model = await db.aiModel.create({data: {key: 'price-model-' + suffix, displayName: '计费模型' + modelSeq, modelCode: 'provider-chat', providerId: provider.id, isActive: true, isDefault: true, sortOrder: -1000 - modelSeq}});
  await db.modelCoinPrice.create({data: {modelId: model.id, coinsPerReply: coins, effectiveAt: new Date(Date.now() - 60_000), createdBy: 'test-operator'}});
  return model;
}

async function enableCharging(model) {
  await setSetting('billing.chargingEnabled', true);
  await setSetting('billing.freeDailyMessages', 0);
  await removeSetting('billing.priceMultiplier');
  await setSetting('billing.dayTimezone', 'UTC');
  return model;
}

const balanceOf = async user => (await db.user.findUniqueOrThrow({where: {id: user.id}, select: {coins: true}})).coins;
const ledgerOf = async (user, chargeId) => db.coinTransaction.findMany({where: {userId: user.id, chargeId}, orderBy: {createdAt: 'asc'}});
const chargeRow = async (user, operation, requestId) => db.generationCharge.findUnique({where: {userId_operation_requestId: {userId: user.id, operation, requestId}}});

test('报价：ceil(coinsPerReply × 倍率 / 1000)，倍率 0 免费，业务日按 billing.dayTimezone', async () => {
  assert.equal(applyPriceMultiplier(10, 1000), 10);
  assert.equal(applyPriceMultiplier(10, 1500), 15);
  assert.equal(applyPriceMultiplier(7, 1234), 9, '8.638 向上取整为 9');
  assert.equal(applyPriceMultiplier(10, 0), 0);
  assert.equal(applyPriceMultiplier(1, 1), 1, '任何非零倍率都不抹成 0');
  assert.equal(applyPriceMultiplier(0, 1000), 0);

  const {user} = await billingFixture();
  await pricedModel(20);
  await setSetting('billing.chargingEnabled', true);
  const base = await quoteReplyPrice({userId: user.id, operation: 'CHAT_SEND', modelKey: null});
  assert.equal(base.baseCoins, 20);
  assert.equal(base.multiplier, 1000);
  assert.equal(base.coins, 20);

  await db.userSettingOverride.create({data: {userId: user.id, key: 'billing.priceMultiplier', value: JSON.stringify(1500), updatedBy: 'test-operator'}});
  const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
  clearKeyEverywhere('billing.priceMultiplier');
  const marked = await quoteReplyPrice({userId: user.id, operation: 'CHAT_SEND'});
  assert.equal(marked.multiplier, 1500);
  assert.equal(marked.coins, 30, '20 × 1500 / 1000');

  // 业务日：UTC 与 Asia/Shanghai 在同一时刻可能是不同的一天。
  const instant = new Date('2026-10-21T20:15:00Z');
  assert.equal(resolveBillingDay(instant, 'UTC'), '2026-10-21');
  assert.equal(resolveBillingDay(instant, 'Asia/Shanghai'), '2026-10-22');
  const boundary = resolveBillingDayBoundary(instant, 'Asia/Shanghai');
  assert.equal(boundary.resetAt.toISOString(), '2026-10-22T16:00:00.000Z', '下一个业务日 00:00（UTC+8）');
});

test('成功只扣一次：HELD 条件扣余额 + 唯一负数流水，SETTLED 归类为聊天消费且不再扣', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  const requestId = randomUUID();

  const hold = await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(hold.held, true);
  assert.equal(hold.status, 'HELD');
  assert.equal(hold.coins, 20);
  assert.equal(hold.allowanceSource, 'PAID');
  assert.equal(hold.debited, 20);
  assert.equal(await balanceOf(user), 80, '预扣后余额 100 - 20');
  const heldLedger = await ledgerOf(user, hold.chargeId);
  assert.equal(heldLedger.length, 1);
  assert.equal(heldLedger[0].amount, -20);
  assert.equal(heldLedger[0].chargeAction, 'HOLD');

  const settled = await settleCharge({userId: user.id, requestId, operation: 'CHAT_SEND', messageId: 'msg-1'});
  assert.equal(settled.status, 'SETTLED');
  assert.equal(settled.balanceDelta, 0, '结算不再扣余额');
  assert.equal(await balanceOf(user), 80);
  const settledLedger = await ledgerOf(user, hold.chargeId);
  assert.equal(settledLedger.length, 1, '仍然只有一条负数流水');
  assert.equal(settledLedger[0].sourceKey, 'CHAT_SPEND');
  assert.equal((await chargeRow(user, 'CHAT_SEND', requestId)).messageId, 'msg-1');

  // 重复结算：同一结果，不重复扣。
  const again = await settleCharge({userId: user.id, requestId, operation: 'CHAT_SEND'});
  assert.equal(again.status, 'SETTLED');
  assert.equal(again.replayed, true);
  assert.equal(again.balanceDelta, 0);
  assert.equal(await balanceOf(user), 80);
  assert.equal((await ledgerOf(user, hold.chargeId)).length, 1);
});

test('失败释放：唯一正数流水补回预扣一次，重复释放不再补', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  const requestId = randomUUID();
  const hold = await holdCharge({userId: user.id, requestId, operation: 'CHAT_REGENERATE', conversationId: conversation.id});
  assert.equal(await balanceOf(user), 80);

  const released = await releaseCharge({userId: user.id, requestId, operation: 'CHAT_REGENERATE', reason: 'UPSTREAM_ERROR'});
  assert.equal(released.status, 'RELEASED');
  assert.equal(released.balanceDelta, 20);
  assert.equal(await balanceOf(user), 100, '补回原预扣金额一次');
  const ledger = await ledgerOf(user, hold.chargeId);
  assert.deepEqual(ledger.map(row => [row.chargeAction, row.amount]), [['HOLD', -20], ['RELEASE', 20]]);
  assert.match(ledger[1].description, /UPSTREAM_ERROR/);

  const again = await releaseCharge({userId: user.id, requestId, operation: 'CHAT_REGENERATE'});
  assert.equal(again.replayed, true);
  assert.equal(again.balanceDelta, 0);
  assert.equal(await balanceOf(user), 100, '不会补第二次');
  assert.equal((await ledgerOf(user, hold.chargeId)).length, 2);

  // 已释放后结算：状态不变，也不退款。
  const settleAfterRelease = await settleCharge({userId: user.id, requestId, operation: 'CHAT_REGENERATE'});
  assert.equal(settleAfterRelease.status, 'RELEASED');
  assert.equal(await balanceOf(user), 100);
});

test('重复 requestId 不重复扣：重放返回同一费用单，消息/会话不一致直接冲突', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  const requestId = randomUUID();

  const first = await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: conversation.id});
  const replay = await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(replay.chargeId, first.chargeId, '同一费用单');
  assert.equal(replay.replayed, true);
  assert.equal(replay.debited, 0);
  assert.equal(await balanceOf(user), 80, '只有一次扣减');
  assert.equal(await db.generationCharge.count({where: {userId: user.id, operation: 'CHAT_SEND'}}), 1);

  const other = await db.conversation.create({data: {userId: user.id, characterId: conversation.characterId}});
  await assert.rejects(holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: other.id}), error => error instanceof ChargeRequestConflictError);
  assert.equal(await balanceOf(user), 80);

  // 并发同号：SQLite 写事务串行，最终仍是一条费用单、一次扣费。
  const raceId = randomUUID();
  const results = await Promise.allSettled([1, 2, 3].map(() => holdCharge({userId: user.id, requestId: raceId, operation: 'CHAT_SEND', conversationId: conversation.id})));
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1, '至少一个请求拿到费用单');
  assert.equal(new Set(fulfilled.map(result => result.value.chargeId)).size, 1, '并发请求共享同一张费用单');
  assert.equal(await balanceOf(user), 60, '80 - 20：并发只扣一次');
  assert.equal(await db.generationCharge.count({where: {userId: user.id, operation: 'CHAT_SEND'}}), 2);
});

test('免费次数：先预占，成功才消耗（free_used+1）；失败释放预占、不消耗', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  await setSetting('billing.freeDailyMessages', 1);

  const before = await readDailyAllowance(user.id);
  assert.equal(before.freeLimit, 1);
  assert.equal(before.freeRemaining, 1);

  const okId = randomUUID();
  const ok = await holdCharge({userId: user.id, requestId: okId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(ok.allowanceSource, 'FREE_QUOTA');
  assert.equal(ok.coins, 0);
  assert.equal(await balanceOf(user), 100, '免费额度不扣币');
  const reserved = await readDailyAllowance(user.id);
  assert.deepEqual([reserved.freeUsed, reserved.freeReserved, reserved.freeRemaining], [0, 1, 0], '只预占，还没消耗');
  // 额度已预占：下一次请求转付费。
  const paid = await holdCharge({userId: user.id, requestId: randomUUID(), operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(paid.allowanceSource, 'PAID');

  await settleCharge({userId: user.id, requestId: okId, operation: 'CHAT_SEND', messageId: 'm-free'});
  const consumed = await readDailyAllowance(user.id);
  assert.deepEqual([consumed.freeUsed, consumed.freeReserved, consumed.freeRemaining], [1, 0, 0], '成功后预占转为已用');
  assert.equal(await balanceOf(user), 80, '免费那条没有扣币，只有付费那条扣了 20');

  // 失败释放：预占还回去，free_used 不变。
  const failId = randomUUID();
  const fail = await holdCharge({userId: user.id, requestId: failId, operation: 'CHAT_REGENERATE', conversationId: conversation.id});
  assert.equal(fail.held, true);
  assert.equal(fail.allowanceSource, 'PAID', '今日免费额度已用完，失败那条走付费');
  const released = await releaseCharge({userId: user.id, requestId: failId, operation: 'CHAT_REGENERATE', reason: 'CANCELLED'});
  assert.equal(released.balanceDelta, 20);
  assert.equal(await balanceOf(user), 80, '失败那条补回了 20，但另一条付费请求仍在冻结中（100-20-20+20）');

  // 下一个业务日：额度重置。
  const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const nextDay = await readDailyAllowance(user.id, {now: tomorrow});
  assert.notEqual(nextDay.day, consumed.day);
  assert.equal(nextDay.freeRemaining, 1);
});

test('关闭计费开关：不建费用单、不扣币；已 HELD 的按实际结果结算', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  const heldId = randomUUID();
  const held = await holdCharge({userId: user.id, requestId: heldId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(await balanceOf(user), 80);

  await setSetting('billing.chargingEnabled', false);
  const freeId = randomUUID();
  const free = await holdCharge({userId: user.id, requestId: freeId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(free.held, false, '关闭后不建费用单');
  assert.equal(free.coins, 0);
  assert.equal(await db.generationCharge.count({where: {userId: user.id, operation: 'CHAT_SEND'}}), 1, '没有新费用单');
  assert.equal(await balanceOf(user), 80, '关闭后不扣币');

  // 关闭后重放旧请求号：仍返回原来的费用单与结果。
  const replay = await holdCharge({userId: user.id, requestId: heldId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal(replay.chargeId, held.chargeId);
  assert.equal(replay.replayed, true);

  const settled = await settleCharge({userId: user.id, requestId: heldId, operation: 'CHAT_SEND', messageId: 'm-held'});
  assert.equal(settled.status, 'SETTLED');
  assert.equal(await balanceOf(user), 80);
  const freeSettle = await settleCharge({userId: user.id, requestId: freeId, operation: 'CHAT_SEND'});
  assert.equal(freeSettle.status, 'FREE');
  assert.equal(freeSettle.chargeId, null);
});

test('余额不足不建单不扣币；UNKNOWN 不重复扣也不自动补回，recovery 只按权威状态处理', async () => {
  const {user, conversation} = await billingFixture({coins: 10});
  await enableCharging(await pricedModel(20));
  await assert.rejects(holdCharge({userId: user.id, requestId: randomUUID(), operation: 'CHAT_SEND', conversationId: conversation.id}), error => error instanceof InsufficientCoinsError && error.coins === 20 && error.balance === 10);
  assert.equal(await balanceOf(user), 10);
  assert.equal(await db.generationCharge.count({where: {userId: user.id}}), 0);

  const {user: rich, conversation: richChat} = await billingFixture({coins: 100});
  const requestId = randomUUID();
  const hold = await holdCharge({userId: rich.id, requestId, operation: 'CHAT_SEND', conversationId: richChat.id});
  const unknown = await markChargeUnknown({userId: rich.id, requestId, operation: 'CHAT_SEND'});
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(await balanceOf(rich), 80, 'UNKNOWN 不自动补回');
  const settleUnknown = await settleCharge({userId: rich.id, requestId, operation: 'CHAT_SEND', messageId: 'late'});
  assert.equal(settleUnknown.status, 'UNKNOWN', '结果不明时不盲目结算或退款');
  assert.equal(await balanceOf(rich), 80);

  // 与真实业务一致的 HELD 单：AiCall 已失败 → recovery 释放且只补一次。
  const call = await db.aiCall.create({data: {userId: rich.id, conversationId: richChat.id, operation: 'SEND', currency: 'USD', status: 'FAILED'}});
  await db.generationCharge.update({where: {id: hold.chargeId}, data: {status: 'HELD', heldAt: new Date(Date.now() - 60 * 60 * 1000), aiCallId: call.id}});
  const result = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.ok(result.outcomes.some(outcome => outcome.chargeId === hold.chargeId && outcome.decision === 'RELEASED'));
  assert.equal(await balanceOf(rich), 100, '按失败结果释放一次');
  assert.equal((await ledgerOf(rich, hold.chargeId)).length, 2);
  const second = await reconcileHeldCharges({holdTimeoutMinutes: 0});
  assert.equal(second.outcomes.some(outcome => outcome.chargeId === hold.chargeId), false, '已释放的单据不再核对');

  // 结果不明且超过两天：自动转 UNKNOWN 挂账，不退款也不重发，下一轮不再重扫。
  const staleId = randomUUID();
  const stale = await holdCharge({userId: rich.id, requestId: staleId, operation: 'CHAT_SEND', conversationId: richChat.id});
  const doneCall = await db.aiCall.create({data: {userId: rich.id, conversationId: richChat.id, operation: 'SEND', currency: 'USD', status: 'SUCCESS'}});
  await db.generationCharge.update({where: {id: stale.chargeId}, data: {heldAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), aiCallId: doneCall.id}});
  const staleRun = await reconcileHeldCharges({holdTimeoutMinutes: 10});
  assert.equal(staleRun.outcomes.find(outcome => outcome.chargeId === stale.chargeId)?.decision, 'UNKNOWN');
  assert.equal((await readCharge(rich.id, 'CHAT_SEND', staleId))?.status, 'UNKNOWN');
  assert.equal(await balanceOf(rich), 80, '结果不明不自动补回余额');
  const staleAgain = await reconcileHeldCharges({holdTimeoutMinutes: 0});
  assert.equal(staleAgain.outcomes.some(outcome => outcome.chargeId === stale.chargeId), false, '转 UNKNOWN 后不再每轮重扫');

  const pending = await readPendingChargeSummary();
  assert.equal(typeof pending.held, 'number');
  // 表结构由迁移本身保证（测试开头 prisma migrate deploy 建库）；这里断言计费表可用。
  const columns = await db.$queryRawUnsafe('PRAGMA table_info("generation_charges")');
  assert.ok(columns.some(column => column.name === 'allowance_source'), '计费表已含额度来源列');
  assert.ok(await readCharge(rich.id, 'CHAT_SEND', requestId));
});

test('聊天与故事共用费用服务：SEND 结算、失败释放；STORY_TURN 提交后结算且关闭开关不扣币', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  const model = await enableCharging(await pricedModel(20));
  // 角色必须显式绑定可用模型，否则运行时模型计划为空（与生产一致）。
  await db.characterAiModel.create({data: {characterId: conversation.characterId, modelKey: model.key}});
  // 上游用可控 SSE 代替真实供应商：计费只看结果，不依赖外网。
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"呀"},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n',
    {status: 200, headers: {'Content-Type': 'text/event-stream'}},
  );

  // SEND：模拟回复（未配置真实 AI），成功保存后结算。
  const sendId = randomUUID();
  const send = await executeChatTurn({userId: user.id, conversationId: conversation.id, mode: 'SEND', input: {request: new Request('http://local/api/conversations/' + conversation.id + '/messages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: '你好', requestId: sendId})})}, signal: new AbortController().signal});
  const sendText = await new Response(send.stream).text();
  assert.match(sendText, /"cost"/, '先发一条计费提示');
  assert.match(sendText, /[DONE]/);
  const sendCharge = await chargeRow(user, 'CHAT_SEND', sendId);
  assert.equal(sendCharge.status, 'SETTLED');
  assert.equal(sendCharge.coins, 20);
  assert.equal(await balanceOf(user), 80);
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 2, '用户消息与回复都已保存');

  // 同一个 requestId 重放：不重复扣币、不重复调用模型。
  const replayText = await new Response((await executeChatTurn({userId: user.id, conversationId: conversation.id, mode: 'SEND', input: {request: new Request('http://local/x', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: '你好', requestId: sendId})})}, signal: new AbortController().signal})).stream).text();
  assert.match(replayText, /[DONE]/);
  assert.equal(await balanceOf(user), 80, '重放不重复收费');
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 2, '重放不重复保存');

  // 故事回合：与聊天同一个费用服务，价格与聊天价一致（未设置 story.coinPrice）。
  const character = await db.character.findUniqueOrThrow({where: {id: conversation.characterId}});
  const template = await db.storyTemplate.create({data: {slug: 'bill-' + randomUUID().slice(0, 8), title: '计费故事', status: 'PUBLISHED'}});
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '介绍', chapters: [{key: 'opening', title: '开场'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const {run} = await createStoryRun(user.id, {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()});
  const storyId = randomUUID();
  const storyStream = await executeStoryTurn({userId: user.id, runId: run.id, input: {expectedRevision: 0, requestId: storyId, content: '开始吧'}, signal: new AbortController().signal});
  const storyText = await new Response(storyStream).text();
  assert.match(storyText, /"committed"/);
  const storyCharge = await chargeRow(user, 'STORY_TURN', storyId);
  assert.equal(storyCharge.status, 'SETTLED');
  assert.equal(storyCharge.coins, 20, '故事价未设置时沿用聊天价');
  assert.equal(await balanceOf(user), 60);
  assert.ok(storyCharge.messageId, '费用单挂上已保存的回复消息');
  assert.equal(storyCharge.aiCallId !== null, true);

  // 关闭收费：故事回合不建费用单、不扣币，只记录 AiCall 成本。
  await setSetting('billing.chargingEnabled', false);
  const revision = (await db.storyRun.findUniqueOrThrow({where: {id: run.id}})).revision;
  const freeStoryId = randomUUID();
  await new Response(await executeStoryTurn({userId: user.id, runId: run.id, input: {expectedRevision: revision, requestId: freeStoryId, content: '再来一回合'}, signal: new AbortController().signal})).text();
  assert.equal(await chargeRow(user, 'STORY_TURN', freeStoryId), null, '关闭后不建费用单');
  assert.equal(await balanceOf(user), 60);
  assert.ok(await db.aiCall.findFirst({where: {userId: user.id, operation: 'SEND', status: 'SUCCEEDED'}}), '成本仍记录在 AiCall');

  // 失败：上游报错 → 释放，余额回到原值，回合记为 FAILED 且不保存回复。
  await setSetting('billing.chargingEnabled', true);
  globalThis.fetch = async () => new Response('data: {"error":{"message":"boom"}}\n\n', {status: 200, headers: {'Content-Type': 'text/event-stream'}});
  const failRevision = (await db.storyRun.findUniqueOrThrow({where: {id: run.id}})).revision;
  const failTurnId = randomUUID();
  await new Response(await executeStoryTurn({userId: user.id, runId: run.id, input: {expectedRevision: failRevision, requestId: failTurnId, content: '这次会失败'}, signal: new AbortController().signal})).text();
  const failCharge = await chargeRow(user, 'STORY_TURN', failTurnId);
  assert.equal(failCharge.status, 'RELEASED');
  assert.equal(await balanceOf(user), 60, '失败释放：预扣补回，不多扣也不少扣');
  assert.equal((await db.storyTurn.findFirstOrThrow({where: {runId: run.id, requestId: failTurnId}})).status, 'FAILED');
  globalThis.fetch = realFetch;
  void model;
});

/** 等到费用单离开 HELD（取消/结算都是异步收尾）。 */
async function waitForCharge(user, operation, requestId) {
  for (let i = 0; i < 100; i += 1) {
    const row = await chargeRow(user, operation, requestId);
    if (row && row.status !== 'HELD') return row;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('费用单一直停在 HELD：' + requestId);
}

test('取消策略：未输出释放不占次数、有免费次数释放并占用、用完按已输出结算、RELEASE_ALWAYS 一律释放', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  await setSetting('billing.freeCancelPerDay', 1);
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');
  assert.equal(await readCancelPolicy(user.id), 'CHARGE_WHEN_OUTPUT');
  const cancel = async (outputDelivered, now) => {
    const requestId = randomUUID();
    await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: conversation.id});
    return settleCancellation({userId: user.id, requestId, operation: 'CHAT_SEND', outputDelivered, now});
  };

  // 1) 首个片段未送达：释放，不消耗免费取消次数。
  assert.equal((await cancel(false)).status, 'RELEASED');
  assert.equal(await balanceOf(user), 100);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 0);

  // 2) 已送达 + 当日还有免费取消次数：释放并占用一次。
  assert.equal((await cancel(true)).status, 'RELEASED');
  assert.equal(await balanceOf(user), 100);
  const used = await readDailyAllowance(user.id);
  assert.deepEqual([used.freeCancelDaily, used.freeCancelUsed, used.freeCancelRemaining], [1, 1, 0]);

  // 3) 次数用完：按已输出结算，余额扣一次。
  assert.equal((await cancel(true)).status, 'SETTLED');
  assert.equal(await balanceOf(user), 80);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1);

  // 4) RELEASE_ALWAYS：已输出也释放，且不占用次数。
  await setSetting('billing.cancelPolicy', 'RELEASE_ALWAYS');
  assert.equal(await readCancelPolicy(user.id), 'RELEASE_ALWAYS');
  const released = await cancel(true);
  assert.equal(released.status, 'RELEASED');
  assert.equal(released.balanceDelta, 20);
  assert.equal(await balanceOf(user), 80);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1);
});

test('取消幂等与并发：重复取消不重复退款，两次同时取消只占用一次免费额度', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  await setSetting('billing.freeCancelPerDay', 1);
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');

  // 并发：同一业务日只剩一次免费取消，两条同时取消只有一条白免。
  const ids = [randomUUID(), randomUUID()];
  for (const requestId of ids) await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: conversation.id});
  const outcomes = await Promise.all(ids.map(requestId => settleCancellation({userId: user.id, requestId, operation: 'CHAT_SEND', outputDelivered: true})));
  assert.deepEqual(outcomes.map(outcome => outcome.status).sort(), ['RELEASED', 'SETTLED']);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1, '只占用一次免费取消');
  assert.equal(await balanceOf(user), 80, '另一条按已输出结算');

  // 重复取消同一条：不再退款、不再占用次数。
  const releasedId = ids[outcomes.findIndex(outcome => outcome.status === 'RELEASED')];
  const again = await settleCancellation({userId: user.id, requestId: releasedId, operation: 'CHAT_SEND', outputDelivered: true});
  assert.equal(again.status, 'RELEASED');
  assert.equal(again.replayed, true);
  assert.equal(again.balanceDelta, 0);
  assert.equal(await balanceOf(user), 80);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1);
});

test('非用户原因一律释放且不吃免费取消次数；免费取消次数按业务日重置', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  await setSetting('billing.freeCancelPerDay', 1);
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');

  // 供应商失败：走 release，不占次数。
  const failedId = randomUUID();
  await holdCharge({userId: user.id, requestId: failedId, operation: 'CHAT_SEND', conversationId: conversation.id});
  const failed = await releaseCharge({userId: user.id, requestId: failedId, operation: 'CHAT_SEND', reason: 'UPSTREAM_ERROR'});
  assert.equal(failed.status, 'RELEASED');
  assert.equal(await balanceOf(user), 100);
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 0);

  // 今天用掉唯一一次免费取消。
  const todayId = randomUUID();
  await holdCharge({userId: user.id, requestId: todayId, operation: 'CHAT_SEND', conversationId: conversation.id});
  assert.equal((await settleCancellation({userId: user.id, requestId: todayId, operation: 'CHAT_SEND', outputDelivered: true})).status, 'RELEASED');
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1);

  // 跨业务日：新的业务日额度从 0 开始，取消又是免费的。
  const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const tomorrowId = randomUUID();
  await holdCharge({userId: user.id, requestId: tomorrowId, operation: 'CHAT_SEND', conversationId: conversation.id, now: tomorrow});
  const tomorrowCancel = await settleCancellation({userId: user.id, requestId: tomorrowId, operation: 'CHAT_SEND', outputDelivered: true, now: tomorrow});
  assert.equal(tomorrowCancel.status, 'RELEASED');
  assert.equal(await balanceOf(user), 100);
  const nextDay = await readDailyAllowance(user.id, {now: tomorrow});
  assert.deepEqual([nextDay.freeCancelUsed, nextDay.freeCancelRemaining], [1, 0], '新业务日重新计一次');
  assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1, '今天那次仍记在今天');
});

test('聊天链路：已输出后取消按策略释放并占用一次免费取消；次数为 0 时按已输出结算', async () => {
  const {user, conversation} = await billingFixture({coins: 100});
  const model = await enableCharging(await pricedModel(20));
  await db.characterAiModel.create({data: {characterId: conversation.characterId, modelKey: model.key}});
  await setSetting('billing.freeCancelPerDay', 3);
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');

  // 上游只吐一个片段就停在那里：用户读到内容后断开，正好是「已输出 + 取消」。
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n'));
      // 客户端断开后连接随之结束：真实上游也是这样收尾的。
      setTimeout(() => { try { controller.close(); } catch { /* already closed */ } }, 150);
    },
  }), {status: 200, headers: {'Content-Type': 'text/event-stream'}});
  const sendAndCancel = async requestId => {
    const abort = new AbortController();
    const request = new Request('http://local/api/conversations/' + conversation.id + '/messages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: '你好', requestId})});
    const {stream} = await executeChatTurn({userId: user.id, conversationId: conversation.id, mode: 'SEND', input: {request}, signal: abort.signal});
    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    abort.abort();
    const row = await waitForCharge(user, 'CHAT_SEND', requestId);
    await reader.cancel().catch(() => {});
    return row;
  };

  try {
    const freeCancelId = randomUUID();
    assert.equal((await sendAndCancel(freeCancelId)).status, 'RELEASED');
    assert.equal(await balanceOf(user), 100, '有免费取消次数时不扣币');
    assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1);
    // V3 表 16：本轮仍不保存部分回复，取消后不落库任何半截内容。
    assert.equal(await db.message.count({where: {conversationId: conversation.id, role: 'ASSISTANT'}}), 0, '不保存部分回复');

    // 免费取消次数为 0：取消即收费，按已输出结算。
    await setSetting('billing.freeCancelPerDay', 0);
    const chargedId = randomUUID();
    assert.equal((await sendAndCancel(chargedId)).status, 'SETTLED');
    assert.equal(await balanceOf(user), 80);
    assert.equal((await readDailyAllowance(user.id)).freeCancelUsed, 1, '次数为 0 时不占用额度');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/me/quota 暴露取消策略与免费取消额度（前端契约字段名不变）', async () => {
  const {user} = await billingFixture({coins: 100});
  await enableCharging(await pricedModel(20));
  await setSetting('billing.freeCancelPerDay', 3);
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');

  const token = await signToken({userId: user.id, email: user.email});
  const read = async () => {
    const response = await readQuota(new Request('http://local/api/me/quota', {headers: {Authorization: 'Bearer ' + token}}));
    assert.equal(response.status, 200);
    return response.json();
  };

  const fresh = await read();
  assert.equal(fresh.cancelPolicy, 'CHARGE_WHEN_OUTPUT');
  assert.equal(fresh.freeCancelDaily, 3);
  assert.equal(fresh.freeCancelRemaining, 3);

  // 后台改成「一律释放」后，同一个接口立即反映新策略。
  await setSetting('billing.cancelPolicy', 'RELEASE_ALWAYS');
  assert.equal((await read()).cancelPolicy, 'RELEASE_ALWAYS');

  // 用掉一次免费取消后剩余次数下降。
  await setSetting('billing.cancelPolicy', 'CHARGE_WHEN_OUTPUT');
  const requestId = randomUUID();
  await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', conversationId: null});
  await settleCancellation({userId: user.id, requestId, operation: 'CHAT_SEND', outputDelivered: true});
  const used = await read();
  assert.equal(used.freeCancelRemaining, 2);

  // 未登录一律 401。
  assert.equal((await readQuota(new Request('http://local/api/me/quota'))).status, 401);
});
