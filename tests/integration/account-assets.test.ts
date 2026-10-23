import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('admin account detail exposes membership assets and usage summary', async t => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const plan = await fixture.db.membershipPlan.update({where: {code: 'MONTHLY'}, data: {priceCents: 3000, isActive: true, benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 5}])}});
  const order = await fixture.db.membershipOrder.create({data: {orderNo: 'ACCOUNT-ASSET-ORDER', userId: fixture.user.id, idempotencyKey: 'account-asset-order', planId: plan.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: plan.benefitsJson, status: 'PAID', paidAt: new Date()}});
  await fixture.db.membershipGrant.create({data: {orderId: order.id, userId: fixture.user.id, startsAt: new Date(Date.now() - 1_000), expiresAt: new Date(Date.now() + 86_400_000), benefitsJson: plan.benefitsJson}});
  await fixture.db.membershipUsage.createMany({data: Array.from({length: 501}, (_, index) => ({orderId: order.id, userId: fixture.user.id, benefitCode: 'DAILY_FREE_REPLIES', quantity: 1, idempotencyKey: `account-asset-usage-${index}`}))});
  const {readManagedAccount} = await import('@rumiai/backend/modules/accounts/management-service');
  const detail = await readManagedAccount(fixture.admin.id, fixture.user.id);
  assert.equal(detail.assets.membership.current?.orderNo, order.orderNo);
  assert.equal(detail.assets.membership.orders[0]?.usage?.consumed, 501);
  assert.equal(detail.assets.finance.visible, true);
  const viewer = await fixture.db.user.create({data: {username: 'account-assets-viewer', email: 'account-assets-viewer@example.test', passwordHash: 'integration-only'}});
  const role = await fixture.db.adminRole.create({data: {code: 'ACCOUNT_ASSETS_VIEWER', name: '账户资产查看测试', permissions: {create: {permission: 'accounts.read'}}}});
  await fixture.db.adminOperator.create({data: {userId: viewer.id, enabled: true}});
  await fixture.db.adminRoleAssignment.create({data: {userId: viewer.id, roleId: role.id}});
  const restricted = await readManagedAccount(viewer.id, fixture.user.id);
  const restrictedOrder = restricted.assets.membership.orders[0];
  assert.equal(restricted.assets.finance.visible, false);
  assert.equal(restricted.assets.finance.ledger, null);
  assert.equal(restrictedOrder?.amountCents, null);
  assert.equal(restrictedOrder?.refund, null);
  assert.equal(restrictedOrder?.usage, null);
});
