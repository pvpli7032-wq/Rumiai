/* Run with: DATABASE_URL=file:./tmp-membership.sqlite npx tsx tests/integration/membership-core.test.ts
 * The script uses the real Prisma service and exits non-zero on any invariant failure. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const {db} = await import('@rumiai/backend/infrastructure/database/client');
const {createMembershipOrder, markMembershipPaid, readMembershipCurrent, recordMembershipUsage, quoteMembershipRefund, requestMembershipRefund, completeMembershipRefund, validateMembershipBenefits} = await import('@rumiai/backend/modules/memberships/service');

assert.throws(() => validateMembershipBenefits([{key: 'DAILY_FREE_REPLIES', label: '重复', value: 1}, {key: 'DAILY_FREE_REPLIES', label: '重复', value: 2}]));
assert.throws(() => validateMembershipBenefits([{key: 'DAILY_FREE_REPLIES', label: '超范围', value: 10001}]));
assert.throws(() => validateMembershipBenefits([{key: 'CHAT_PRICE_MULTIPLIER', label: '非法类型', value: true}]));

const user = await db.user.create({data: {username: `membership_test_${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@test.invalid`, passwordHash: 'test', displayName: 'membership test'}});
const plan = await db.membershipPlan.create({data: {code: `TEST_${randomUUID().slice(0, 8).toUpperCase()}`, name: '测试会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 10}]), isActive: true}});
await db.membershipPolicy.create({data: {id: 'primary', refundWindowHours: 24, usageChargePeriodHours: 24}}).catch(() => undefined);

const paidAt = new Date('2026-01-01T00:00:00.000Z');
const first = await createMembershipOrder({userId: user.id, planCode: plan.code, idempotencyKey: 'same-order', orderNo: 'TEST-MEMBERSHIP-1'});
assert.equal((await createMembershipOrder({userId: user.id, planCode: plan.code, idempotencyKey: 'same-order', orderNo: 'ignored'})).id, first.id, 'order creation must be idempotent');
const firstGrant = await markMembershipPaid(first.orderNo, paidAt);
assert.equal(firstGrant.expiresAt.toISOString(), '2026-01-31T00:00:00.000Z');
const second = await createMembershipOrder({userId: user.id, planCode: plan.code, idempotencyKey: 'second-order', orderNo: 'TEST-MEMBERSHIP-2'});
const secondGrant = await markMembershipPaid(second.orderNo, paidAt);
assert.equal(secondGrant.startsAt.toISOString(), firstGrant.expiresAt.toISOString(), 'renewal must start at current expiry');

// Snapshot policy: changing global policy cannot change an existing order quote.
await db.membershipPolicy.update({where: {id: 'primary'}, data: {refundWindowHours: 1, usageChargePeriodHours: 12}});
const quote = await quoteMembershipRefund(first.orderNo, new Date('2026-01-01T12:00:00.000Z'));
assert.equal(quote.amountCents, 3000, 'unused order must be fully refundable using its snapshot');
const refund = await requestMembershipRefund(first.orderNo, '测试退款', new Date('2026-01-01T12:00:00.000Z'));
assert.equal(refund.amountCents, 3000);
await completeMembershipRefund(first.orderNo, undefined, new Date('2026-01-01T12:00:00.000Z'));
const shifted = await db.membershipGrant.findUnique({where: {orderId: second.id}});
assert.equal(shifted?.startsAt.toISOString(), '2026-01-01T12:00:00.000Z', 'future renewal keeps its duration and shifts over refunded remaining period');

// A used order deducts exactly one configured 24-hour period (3000 / 30).
await db.membershipPolicy.update({where: {id: 'primary'}, data: {refundWindowHours: 24, usageChargePeriodHours: 24}});
const usedOrder = await createMembershipOrder({userId: user.id, planCode: plan.code, idempotencyKey: 'used-order', orderNo: 'TEST-MEMBERSHIP-3'});
await markMembershipPaid(usedOrder.orderNo, new Date('2026-02-01T00:00:00.000Z'));
await recordMembershipUsage({orderNo: usedOrder.orderNo, userId: user.id, benefitCode: 'DAILY_FREE_REPLIES', idempotencyKey: 'usage-1', now: new Date('2026-02-01T01:00:00.000Z')});
const usedQuote = await quoteMembershipRefund(usedOrder.orderNo, new Date('2026-02-01T01:00:00.000Z'));
assert.equal(usedQuote.deductedCents, 100);
assert.equal(usedQuote.amountCents, 2900);

// Refund creation freezes further entitlement consumption.
await requestMembershipRefund(usedOrder.orderNo, '测试退款', new Date('2026-02-01T01:00:00.000Z'));
await assert.rejects(() => recordMembershipUsage({orderNo: usedOrder.orderNo, userId: user.id, benefitCode: 'DAILY_FREE_REPLIES', idempotencyKey: 'usage-after-refund'}));

const current = await readMembershipCurrent(user.id, new Date('2026-02-01T02:00:00.000Z'));
assert.ok(current, 'a non-refunded renewal remains active');
assert.equal(current?.renewalExpiresAt, current?.expiresAt, 'current projection exposes latest effective expiry');
await db.$disconnect();
console.log('membership-core: PASS');
