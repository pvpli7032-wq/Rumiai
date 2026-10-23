import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../helpers/sqlite-fixture.mjs';

test('membership payment and refund remain separate from coin finance', async t => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const { db } = fixture;
  const now = new Date();
  const plan = await db.membershipPlan.upsert({
    where: {code: 'MONTHLY'},
    update: {
      name: '测试月会员', durationDays: 30, priceCents: 3000,
      benefitsJson: JSON.stringify([{key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 0.8}]),
      isActive: true, sortOrder: 0, version: 1,
    },
    create: {
      code: 'MONTHLY', name: '测试月会员', durationDays: 30, priceCents: 3000,
      benefitsJson: JSON.stringify([{key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 0.8}]),
      isActive: true, sortOrder: 0, version: 1,
    },
  });
  await db.membershipPolicy.upsert({where: {id: 'primary'}, update: {refundWindowHours: 24, usageChargePeriodHours: 24}, create: {id: 'primary', refundWindowHours: 24, usageChargePeriodHours: 24, version: 1}});
  const backend = await import('@rumiai/backend/infrastructure/database/client');
  const { createMembershipOrder, markMembershipPaid, recordMembershipUsage, requestMembershipRefund, completeMembershipRefund } = await import('@rumiai/backend/modules/memberships/service');
  const { readFinanceReport } = await import('@rumiai/backend/modules/payments/reconciliation-service');
  const { listPaymentOrders, exportPaymentOrders } = await import('@rumiai/backend/modules/payments/order-management-service');

  async function paidOrder(suffix: string) {
    const paymentOrder = await db.paymentOrder.create({data: {
      orderNo: `MEM-PAY-${suffix}`, idempotencyKey: `mem-pay-${suffix}`, userId: fixture.user.id,
      packageCoins: 0, packageBonus: 0, coinAmount: 0, amountCnyCents: 3000,
      currency: 'CNY', provider: 'EZFP', providerTradeNo: `trade-${suffix}`,
      status: 'PENDING', createdAt: now,
    }});
    const membership = await createMembershipOrder({userId: fixture.user.id, planCode: plan.code, idempotencyKey: `membership-${suffix}`, orderNo: `MEM-${suffix}`, paymentOrderId: paymentOrder.id});
    await markMembershipPaid(membership.orderNo, now);
    await db.paymentOrder.update({where: {id: paymentOrder.id}, data: {status: 'PAID', paidAt: now}});
    return membership.orderNo;
  }

  const usedOrder = await paidOrder('USED');
  await recordMembershipUsage({orderNo: usedOrder, userId: fixture.user.id, benefitCode: 'CHAT_PRICE_MULTIPLIER', idempotencyKey: 'membership-usage-finance-used'});
  const usedRequest = await requestMembershipRefund(usedOrder, '测试已使用退款', now);
  assert.equal(usedRequest.amountCents, 2900);
  assert.equal(usedRequest.deductedCents, 100);
  await completeMembershipRefund(usedOrder, 'refund-used', now);

  const unusedOrder = await paidOrder('UNUSED');
  const unusedRequest = await requestMembershipRefund(unusedOrder, '测试未使用退款', now);
  assert.equal(unusedRequest.amountCents, 3000);
  assert.equal(unusedRequest.deductedCents, 0);
  await completeMembershipRefund(unusedOrder, 'refund-unused', now);

  const report = await readFinanceReport(90);
  assert.equal(report.paidOrders, 2);
  assert.equal(report.paidAmountCnyCents, 6000);
  assert.equal(report.completedRefunds, 2);
  assert.equal(report.refundedAmountCnyCents, 5900);
  assert.equal(report.netAfterRefundsCnyCents, 100);
  assert.equal(report.membershipPaidOrders, 2);
  assert.equal(report.membershipPaidAmountCents, 6000);
  assert.equal(report.membershipCompletedRefunds, 2);
  assert.equal(report.membershipRefundedAmountCents, 5900);
  assert.equal(report.orderAnomalies.length, 0);
  assert.equal(report.refundAnomalies.length, 0);

  const listed = await listPaymentOrders({page: 1, pageSize: 10});
  assert.equal(listed.total, 2);
  assert.deepEqual(new Set(listed.items.map(item => item.orderType)), new Set(['MEMBERSHIP']));
  assert.ok(listed.items.every(item => item.coinAmount === 0 && item.membershipOrder?.amountCents === 3000));
  assert.ok(listed.items.every(item => item.refund?.amountCnyCents === (item.orderNo.includes('UNUSED') ? 3000 : 2900)));

  const exported = await exportPaymentOrders({});
  assert.equal(exported.length, 2);
  assert.ok(exported.every(item => item.orderType === 'MEMBERSHIP' && item.coinAmount === 0));
  assert.deepEqual(new Set(exported.map(item => item.refund?.amountCnyCents)), new Set([2900, 3000]));
  const {buildPaymentOrdersCsv} = await import('../../apps/api/src/app/api/admin/finance/orders/export/route');
  const csv = buildPaymentOrdersCsv(exported);
  assert.match(csv, /订单类型/);
  assert.match(csv, /会员订单号/);
  assert.match(csv, /退款金额分/);
  assert.match(csv, /会员退款记录/);
  assert.match(csv, /2900/);
  assert.match(csv, /3000/);
  const coinPayment = await db.paymentOrder.create({data: {
    orderNo: 'COIN-FINANCE-EXPORT', idempotencyKey: 'coin-finance-export', userId: fixture.user.id,
    packageCoins: 100, packageBonus: 0, coinAmount: 100, amountCnyCents: 2000,
    currency: 'CNY', provider: 'EZFP', providerTradeNo: 'coin-trade-finance', status: 'PAID', paidAt: now,
  }});
  await db.paymentRefund.create({data: {
    paymentOrderId: coinPayment.id, refundNo: 'coin-refund-finance', actorId: fixture.admin.id,
    reason: '金币订单导出测试', amountCnyCents: 1200, coinAmount: 60, status: 'COMPLETED', completedAt: now,
  }});
  const coinExport = await exportPaymentOrders({query: 'COIN-FINANCE-EXPORT'});
  assert.equal(coinExport.length, 1);
  assert.equal(coinExport[0].orderType, 'COINS');
  assert.equal(coinExport[0].refund?.amountCnyCents, 1200);
  const coinCsv = buildPaymentOrdersCsv(coinExport);
  assert.match(coinCsv, /1200/);
  assert.equal(await backend.db.membershipRefund.count({where: {status: 'COMPLETED'}}), 2);
});
