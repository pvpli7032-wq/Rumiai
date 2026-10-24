import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const enabled = Boolean(process.env.MEMBERSHIP_INTEGRATION_DB);
const it = enabled ? test : test.skip;
let db: import('@prisma/client').PrismaClient;
let service: typeof import('@rumiai/backend/modules/memberships/service');

before(async () => {
  if (!enabled) return;
  const databasePath = process.env.MEMBERSHIP_INTEGRATION_DB!;
  process.env.DATABASE_URL = databasePath.startsWith('file:') ? databasePath : `file:${databasePath}`;
  const prisma = await import('@prisma/client');
  db = new prisma.PrismaClient();
  await db.$connect();
  service = await import('@rumiai/backend/modules/memberships/service');
});

async function fixture(used = false) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await db.user.create({data: {username: `m${suffix}`.slice(0, 90), email: `m${suffix}@example.test`, passwordHash: 'integration-only'}});
  const plan = await db.membershipPlan.create({data: {code: `TEST_${suffix}`.slice(0, 80), name: '测试月会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 100}])}});
  const payment = await db.paymentOrder.create({data: {orderNo: `KP${suffix}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 40), idempotencyKey: `pi-${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80), userId: user.id, packageCoins: 0, packageBonus: 0, coinAmount: 0, amountCnyCents: 3000, status: 'PAID', providerTradeNo: `T${suffix}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 40), paidAt: new Date()}});
  const order = await db.membershipOrder.create({data: {orderNo: `MO${suffix}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 50), userId: user.id, idempotencyKey: `mi-${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90), planId: plan.id, paymentOrderId: payment.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: plan.benefitsJson, status: 'PAID', paidAt: new Date()}});
  const grant = await db.membershipGrant.create({data: {orderId: order.id, userId: user.id, startsAt: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() + 29 * 86400000), benefitsJson: plan.benefitsJson}});
  if (used) await db.membershipUsage.create({data: {orderId: order.id, userId: user.id, benefitCode: 'DAILY_FREE_REPLIES', idempotencyKey: `use-${suffix}`}});
  return {user, order, grant, payment};
}

after(async () => { if (db) await db.$disconnect(); });

it('refund quote is owned by membership core and deducts exactly one 24h period', async () => {
  const f = await fixture(true);
  const quote = await service.quoteMembershipRefund(f.order.orderNo);
  assert.equal(quote.eligible, true);
  assert.equal(quote.deductedCents, 100);
  assert.equal(quote.amountCents, 2900);
});

it('pending refund does not revoke grant before provider confirmation', async () => {
  const f = await fixture(true);
  const refund = await service.requestMembershipRefund(f.order.orderNo, 'integration provider uncertainty');
  assert.equal(refund.status, 'PENDING');
  const stillActive = await db.membershipGrant.findUnique({where: {id: f.grant.id}});
  assert.equal(stillActive?.status, 'ACTIVE');
});

it('successful refund revokes only its own grant and is idempotent', async () => {
  const f = await fixture(false);
  const other = await fixture(false);
  await service.requestMembershipRefund(f.order.orderNo);
  await service.completeMembershipRefund(f.order.orderNo, 'provider-refund-integration');
  await service.completeMembershipRefund(f.order.orderNo, 'provider-refund-integration');
  assert.equal((await db.membershipGrant.findUnique({where: {id: f.grant.id}}))?.status, 'REVOKED');
  assert.equal((await db.membershipGrant.findUnique({where: {id: other.grant.id}}))?.status, 'ACTIVE');
});

it('concurrent refund requests create one record', async () => {
  const f = await fixture(false);
  const rows = await Promise.all([service.requestMembershipRefund(f.order.orderNo), service.requestMembershipRefund(f.order.orderNo)]);
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
});

it('reserved entitlement blocks refund until release, while released usage is fully refundable', async () => {
  const f = await fixture(false);
  await db.membershipUsage.create({data: {orderId: f.order.id, userId: f.user.id, benefitCode: 'DAILY_FREE_REPLIES', state: 'RESERVED', chargeId: `charge-${f.user.id}`, idempotencyKey: `reserved-${f.user.id}`} });
  const quote = await service.quoteMembershipRefund(f.order.orderNo);
  assert.equal(quote.eligible, false);
  await assert.rejects(() => service.requestMembershipRefund(f.order.orderNo), {code: 'USAGE_RESERVED'});
  await db.membershipUsage.updateMany({where: {chargeId: `charge-${f.user.id}`}, data: {state: 'RELEASED'}});
  const releasedQuote = await service.quoteMembershipRefund(f.order.orderNo);
  assert.equal(releasedQuote.amountCents, 3000);
});

it('membership callback signature and amount/PID checks reject tampering', async () => {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const {signEzfpParams} = await import('@rumiai/backend/modules/payments/ezfp-v2');
  const {verifyMembershipEzfpCallback} = await import('@rumiai/backend/modules/payments/membership-provider');
  const params: Record<string, string> = {out_trade_no: 'ORDER1234', trade_no: 'TRADE1234', money: '30.00', pid: '10001', trade_status: 'TRADE_SUCCESS', timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA'};
  params.sign = signEzfpParams(params, privateKey.export({type: 'pkcs1', format: 'pem'}).toString());
  const query = new URLSearchParams(params);
  const config = {pid: '10001', privateKey: privateKey.export({type: 'pkcs1', format: 'pem'}).toString(), publicKey: publicKey.export({type: 'pkcs1', format: 'pem'}).toString(), baseUrl: 'http://127.0.0.1:9', revisionId: null, environment: 'TEST', refundsEnabled: true};
  const valid = verifyMembershipEzfpCallback(`https://example.test/notify?${query}`, config, {orderNo: 'ORDER1234', amountCnyCents: 3000});
  assert.equal(valid.amountCnyCents, 3000);
  assert.throws(() => verifyMembershipEzfpCallback(`https://example.test/notify?${query}&tamper=1`, config, {orderNo: 'ORDER1234', amountCnyCents: 2900}));
});
