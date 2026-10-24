import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';

const enabled = Boolean(process.env.MEMBERSHIP_INTEGRATION_DB);
const it = enabled ? test : test.skip;
let db: import('@prisma/client').PrismaClient;
let membership: typeof import('@rumiai/backend/modules/memberships/service');
let readFreeDailyLimit: typeof import('@rumiai/backend/modules/billing/allowance').readFreeDailyLimit;

before(async () => {
  if (!enabled) return;
  const databasePath = process.env.MEMBERSHIP_INTEGRATION_DB!;
  process.env.DATABASE_URL = databasePath.startsWith('file:') ? databasePath : `file:${databasePath}`;
  const prisma = await import('@prisma/client');
  db = new prisma.PrismaClient();
  await db.$connect();
  membership = await import('@rumiai/backend/modules/memberships/service');
  ({readFreeDailyLimit} = await import('@rumiai/backend/modules/billing/allowance'));
});

async function fixture(benefits: unknown[], state: 'ACTIVE'|'FUTURE'|'EXPIRED'|'REFUNDED' = 'ACTIVE') {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const user = await db.user.create({data: {username: `mb${suffix}`, email: `mb${suffix}@example.test`, passwordHash: 'integration-only'}});
  const plan = await db.membershipPlan.create({data: {code: `MB${suffix}`.slice(0, 80), name: '权益测试会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify(benefits)}});
  const order = await db.membershipOrder.create({data: {orderNo: `MBORDER${suffix}`, userId: user.id, idempotencyKey: `mb-${suffix}`, planId: plan.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: JSON.stringify(benefits), status: 'PAID', paidAt: new Date(Date.now() - 3600000)}});
  const grant = await db.membershipGrant.create({data: {orderId: order.id, userId: user.id, startsAt: state === 'FUTURE' ? new Date(Date.now() + 3600000) : new Date(Date.now() - 3600000), expiresAt: state === 'EXPIRED' ? new Date(Date.now() - 1000) : new Date(Date.now() + 29 * 86400000), benefitsJson: JSON.stringify(benefits), status: state === 'REFUNDED' ? 'REVOKED' : 'ACTIVE'}});
  return {user, plan, order, grant};
}

after(async () => { if (db) await db.$disconnect(); });

it('membership daily reply entitlement is applied over the ordinary limit', async () => {
  const f = await fixture([{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 5}]);
  assert.equal(await readFreeDailyLimit(f.user.id), 5);
  const rows = await db.membershipUsage.count({where: {orderId: f.order.id}});
  assert.equal(rows, 0, '读取额度不能伪造使用记录');
});

it('future, expired and revoked grants cannot be consumed', async () => {
  for (const state of ['FUTURE', 'EXPIRED', 'REFUNDED'] as const) {
    const f = await fixture([{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 5}], state);
    assert.equal(await membership.readMembershipBenefit(f.user.id, 'DAILY_FREE_REPLIES'), null);
  }
});

it('membership usage is idempotent and owned by the grant order', async () => {
  const f = await fixture([{key: 'CHAT_PRICE_MULTIPLIER', label: '收费倍率', value: 0.5}]);
  const input = {orderNo: f.order.orderNo, userId: f.user.id, benefitCode: 'CHAT_PRICE_MULTIPLIER', idempotencyKey: `use-${f.order.id}`};
  const first = await membership.recordMembershipUsage(input);
  const replay = await membership.recordMembershipUsage(input);
  assert.equal(replay.id, first.id);
  assert.equal((await db.membershipUsage.count({where: {orderId: f.order.id}})), 1);
  const other = await fixture([{key: 'CHAT_PRICE_MULTIPLIER', label: '收费倍率', value: 0.5}]);
  await assert.rejects(() => membership.recordMembershipUsage({...input, orderNo: other.order.orderNo, userId: other.user.id}), {code: 'IDEMPOTENCY_CONFLICT'});
});

it('unsupported benefit codes are rejected instead of becoming display-only promises', async () => {
  await assert.rejects(() => membership.saveMembershipPlan('operator', {code: 'MONTHLY', name: '测试', durationDays: 30, priceCents: 100, isActive: true, benefits: [{key: 'FREE_STICKERS', label: '贴纸', value: 10}], reason: 'integration'}));
});
