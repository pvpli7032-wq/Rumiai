import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 支付链路重放下的通知幂等（V3 §26 实测）。
 *
 * 到账通知的幂等键是那笔 coin_transactions 的 id。这条键只有在
 * 「重放不会新建流水行」时才成立，所以这里真的重放一遍：
 * - 结算回调重复投递：订单状态条件更新拦住第二次，流水只有一行；
 * - 渠道拒绝退款后的回冲、管理员驳回退款后的回冲：`refund_release_id` 上有唯一约束，
 *   同一笔退款只可能有一行回冲流水。
 * 三种重放都必须做到「金币只动一次、通知只落一条」。
 */

const file = `notification-replay-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.NEXT_PUBLIC_SITE_URL = 'https://example.invalid';
process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.EZFP_ENABLED = 'true';
process.env.EZFP_REFUNDS_ENABLED = 'true';
process.env.EZFP_PID = '9101999';
process.env.EZFP_API_BASE_URL = 'http://127.0.0.1:19090';

const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const pair = () => generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
const merchantKeys = pair(), platformKeys = pair();
process.env.EZFP_MERCHANT_PRIVATE_KEY = merchantKeys.privateKey;
process.env.EZFP_PLATFORM_PUBLIC_KEY = platformKeys.publicKey;

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {signEzfpParams} = await import('../src/lib/payments/ezfp-v2.ts');
const {settleEzfpNotification} = await import('../src/lib/payments/settlement-service.ts');
const {requestFullPaymentRefund, rejectFullPaymentRefund, approveFullPaymentRefund} = await import('../src/lib/payments/refund-service.ts');

const [payer, requester, approver] = await Promise.all([
  db.user.create({data: {username: 'replay-payer', email: 'replay-payer@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'replay-requester', email: 'replay-requester@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'replay-approver', email: 'replay-approver@example.invalid', passwordHash: 'synthetic-only'}}),
]);

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

const coinsOf = async userId => (await db.user.findUniqueOrThrow({where: {id: userId}, select: {coins: true}})).coins;
const noticesOf = (userId, type) => db.notification.count({where: {userId, type}});

/** 一笔已到账的订单 + 它的充值流水（退款申请要求这条流水存在且金额一致）。 */
async function paidOrder(userId, orderNo, coins) {
  const order = await db.paymentOrder.create({data: {
    orderNo, idempotencyKey: randomUUID(), userId,
    packageCoins: coins, packageBonus: 0, coinAmount: coins, amountCnyCents: coins,
    status: 'PAID', provider: 'EZFP', currency: 'CNY', providerTradeNo: 'PROVIDER-' + orderNo, paidAt: new Date(),
  }});
  await db.coinTransaction.create({data: {userId, paymentOrderId: order.id, sourceKey: 'PAYMENT_PURCHASE', amount: coins, type: 'PURCHASE', description: '合成充值'}});
  return order;
}

/** 渠道返回一份签名合法但 code !== 0 的应答：这才会走到 failAndRelease。 */
function mockProviderRejection() {
  return async () => {
    const payload = {code: 1, timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA'};
    payload.sign = signEzfpParams(payload, platformKeys.privateKey);
    return new Response(JSON.stringify(payload), {status: 200, headers: {'content-type': 'application/json'}});
  };
}

test('结算回调重复投递：金币只加一次，到账通知只有一条', async () => {
  const orderNo = 'REPLAY-SETTLE-' + Date.now();
  const order = await db.paymentOrder.create({data: {
    orderNo, idempotencyKey: randomUUID(), userId: payer.id,
    packageCoins: 100, packageBonus: 0, coinAmount: 100, amountCnyCents: 100,
  }});
  const coinsBefore = await coinsOf(payer.id);
  const callback = {pid: '9101999', trade_status: 'TRADE_SUCCESS', out_trade_no: orderNo, trade_no: 'PROVIDER-SETTLE-' + orderNo, money: '1.00', timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA'};
  callback.sign = signEzfpParams(callback, platformKeys.privateKey);
  const callbackUrl = `https://lh.y-98.cn/api/coins/payments/ezfp/notify?${new URLSearchParams(callback)}`;

  assert.deepEqual(await settleEzfpNotification(callbackUrl), {duplicate: false});
  // 同一份回调再投递两次（支付平台重试的常态）。
  assert.deepEqual(await settleEzfpNotification(callbackUrl), {duplicate: true});
  assert.deepEqual(await settleEzfpNotification(callbackUrl), {duplicate: true});

  assert.equal(await coinsOf(payer.id), coinsBefore + 100, '金币只加一次');
  assert.equal(await db.coinTransaction.count({where: {paymentOrderId: order.id}}), 1, '同一订单只有一行充值流水');
  assert.equal(await noticesOf(payer.id, 'COIN_RECEIVED'), 1, '到账通知只有一条');
});

test('渠道拒绝退款后的回冲：重放不重复回冲、不重复通知', async () => {
  const orderNo = 'REPLAY-REFUND-PROVIDER-' + Date.now();
  await paidOrder(payer.id, orderNo, 80);
  const coinsBefore = await coinsOf(payer.id);
  await requestFullPaymentRefund(orderNo, requester.id, '渠道拒绝回冲验收');
  assert.equal(await coinsOf(payer.id), coinsBefore - 80, '申请退款时预留金币');

  const original = globalThis.fetch;
  globalThis.fetch = mockProviderRejection();
  try {
    await assert.rejects(() => approveFullPaymentRefund(orderNo, approver.id, '审批后渠道拒绝'), error => error.status === 502);
  } finally {
    globalThis.fetch = original;
  }

  const refund = await db.paymentRefund.findFirstOrThrow({where: {paymentOrder: {orderNo}}, select: {id: true, status: true}});
  assert.equal(refund.status, 'FAILED');
  assert.equal(await coinsOf(payer.id), coinsBefore, '回冲后余额复原');
  assert.equal(await db.coinTransaction.count({where: {refundReleaseId: refund.id}}), 1, '同一退款只有一行回冲流水');
  assert.equal(await noticesOf(payer.id, 'COIN_RECEIVED'), 2, '结算一条 + 回冲一条');

  // 重放：退款已结束，不会再走一次回冲。
  await assert.rejects(() => approveFullPaymentRefund(orderNo, approver.id, '重复审批'), error => error.status === 409);
  assert.equal(await db.coinTransaction.count({where: {refundReleaseId: refund.id}}), 1, '重放不新建回冲流水');
  assert.equal(await noticesOf(payer.id, 'COIN_RECEIVED'), 2, '重放不重复通知');
});

test('管理员驳回退款后的回冲：重放不重复回冲、不重复通知', async () => {
  const orderNo = 'REPLAY-REFUND-ADMIN-' + Date.now();
  await paidOrder(requester.id, orderNo, 60);
  const coinsBefore = await coinsOf(requester.id);
  await requestFullPaymentRefund(orderNo, requester.id, '管理员驳回回冲验收');
  assert.equal(await coinsOf(requester.id), coinsBefore - 60);

  await rejectFullPaymentRefund(orderNo, approver.id, '驳回验收');
  const refund = await db.paymentRefund.findFirstOrThrow({where: {paymentOrder: {orderNo}}, select: {id: true, status: true}});
  assert.equal(refund.status, 'REJECTED');
  assert.equal(await coinsOf(requester.id), coinsBefore, '驳回后余额复原');
  assert.equal(await db.coinTransaction.count({where: {refundReleaseId: refund.id}}), 1);
  assert.equal(await noticesOf(requester.id, 'COIN_RECEIVED'), 1);

  await assert.rejects(() => rejectFullPaymentRefund(orderNo, approver.id, '重复驳回'), error => error.status === 409);
  assert.equal(await db.coinTransaction.count({where: {refundReleaseId: refund.id}}), 1, '重放不新建回冲流水');
  assert.equal(await noticesOf(requester.id, 'COIN_RECEIVED'), 1, '重放不重复通知');
});
