import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('direct referrals and affiliate ledger are bounded, idempotent, and refund-safe', async t => {
  const fixture = await createFixture(); t.after(() => fixture.cleanup());
  const referrals = await import('@rumiai/backend/modules/referrals/service');
  const affiliate = await import('@rumiai/backend/modules/affiliate/service');
  const {saveChanges} = await import('@rumiai/backend/modules/settings/service');
  const passwordHash = (await fixture.db.user.findUniqueOrThrow({where: {id: fixture.user.id}, select: {passwordHash: true}})).passwordHash;
  const child = await fixture.db.user.create({data: {username: 'direct-child', email: 'direct-child@example.test', passwordHash}});
  const grandchild = await fixture.db.user.create({data: {username: 'direct-grandchild', email: 'direct-grandchild@example.test', passwordHash}});
  const unrelated = await fixture.db.user.create({data: {username: 'unrelated-buyer', email: 'unrelated@example.test', passwordHash}});

  const concurrentOwner = await fixture.db.user.create({data: {username: 'concurrent-owner', email: 'concurrent-owner@example.test', passwordHash}});
  const concurrentlyCreated = await Promise.all(Array.from({length: 8}, () => referrals.ensureActiveInviteCode(concurrentOwner.id)));
  assert.equal(new Set(concurrentlyCreated.map(row => row.id)).size, 1, 'concurrent first reads must converge on one durable code');
  assert.equal(await fixture.db.inviteCode.count({where: {ownerId: concurrentOwner.id}}), 1);

  const rootCode = await referrals.ensureActiveInviteCode(fixture.user.id);
  await referrals.updateInviteCode(fixture.user.id, {id: rootCode.id, version: rootCode.version, enabled: true, maxUses: 1, expiresAt: new Date(Date.now() + 60_000).toISOString()});
  await fixture.db.$transaction(tx => referrals.bindReferralInTransaction(tx, {inviteCode: rootCode.code, inviteeId: child.id}));
  await assert.rejects(() => fixture.db.$transaction(tx => referrals.bindReferralInTransaction(tx, {inviteCode: rootCode.code, inviteeId: grandchild.id})), /上限|状态/);
  await assert.rejects(() => fixture.db.$transaction(tx => referrals.bindReferralInTransaction(tx, {inviteCode: rootCode.code, inviteeId: child.id})), /已经绑定/);

  const childCode = await referrals.ensureActiveInviteCode(child.id);
  const disabledCode = await referrals.updateInviteCode(child.id, {id: childCode.id, version: childCode.version, enabled: false, maxUses: null, expiresAt: null});
  await assert.rejects(() => referrals.resolveInvitation(childCode.code), /停用/);
  const expiredCode = await referrals.updateInviteCode(child.id, {id: childCode.id, version: disabledCode.version, enabled: true, maxUses: null, expiresAt: new Date(Date.now() - 1000).toISOString()});
  await assert.rejects(() => referrals.resolveInvitation(childCode.code), /过期/);
  const reenabledCode = await referrals.updateInviteCode(child.id, {id: childCode.id, version: expiredCode.version, enabled: true, maxUses: null, expiresAt: new Date(Date.now() + 60_000).toISOString()});
  assert.equal(reenabledCode.status, 'ACTIVE');
  await assert.rejects(() => referrals.updateInviteCode(child.id, {id: childCode.id, version: childCode.version, enabled: true, maxUses: null, expiresAt: null}), /已更新/);
  await fixture.db.$transaction(tx => referrals.bindReferralInTransaction(tx, {inviteCode: childCode.code, inviteeId: grandchild.id}));
  await assert.rejects(() => fixture.db.$transaction(tx => referrals.bindReferralInTransaction(tx, {inviteCode: childCode.code, inviteeId: child.id})), /自己|已经绑定/);

  const initial = await affiliate.readAffiliatePolicy(); assert.equal(initial.enabled, false);
  await assert.rejects(() => saveChanges({operatorId: fixture.admin.id, changes: [{key: 'affiliate.enabled', value: true}], expectedVersions: {'affiliate.enabled': 0}}), /必须明确/);
  await assert.rejects(() => saveChanges({operatorId: fixture.admin.id, changes: [{key: 'affiliate.commissionPercent', value: 10.001}], expectedVersions: {'affiliate.commissionPercent': 0}}), /两位小数/);
  await saveChanges({operatorId: fixture.admin.id, changes: [{key: 'affiliate.enabled', value: true}, {key: 'affiliate.commissionPercent', value: 10}, {key: 'affiliate.eligibleOrderTypes', value: ['COIN', 'MEMBERSHIP']}, {key: 'affiliate.settlementDelayHours', value: 24}, {key: 'affiliate.minimumWithdrawalCents', value: 100}], expectedVersions: {}});
  const policy = await affiliate.readAffiliatePolicy(); assert.equal(policy.commissionBps, 1000);

  const paidAt = new Date('2026-10-23T00:00:00Z');
  const first = await fixture.db.$transaction(tx => affiliate.recordAffiliateOrderPaidInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'coin-order-1', buyerId: child.id, amountCents: 10_000, currency: 'CNY', paidAt}));
  assert.equal(first?.beneficiaryUserId, fixture.user.id); assert.equal(first?.commissionCents, 1000);
  const duplicate = await fixture.db.$transaction(tx => affiliate.recordAffiliateOrderPaidInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'coin-order-1', buyerId: child.id, amountCents: 10_000, currency: 'CNY', paidAt}));
  assert.equal(duplicate?.id, first?.id); assert.equal(await fixture.db.affiliateAccrual.count({where: {sourceOrderId: 'coin-order-1'}}), 1);

  const grandchildOrder = await fixture.db.$transaction(tx => affiliate.recordAffiliateOrderPaidInTransaction(tx, {sourceType: 'MEMBERSHIP', sourceOrderId: 'membership-order-1', buyerId: grandchild.id, amountCents: 5000, currency: 'CNY', paidAt}));
  assert.equal(grandchildOrder?.beneficiaryUserId, child.id, 'only the direct parent receives commission');
  assert.notEqual(grandchildOrder?.beneficiaryUserId, fixture.user.id);
  assert.equal(await fixture.db.$transaction(tx => affiliate.recordAffiliateOrderPaidInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'unrelated-before-bind', buyerId: unrelated.id, amountCents: 1000, currency: 'CNY'})), null, 'orders before a relationship are not retroactive');
  await fixture.db.affiliateAccrual.update({where: {id: grandchildOrder!.id}, data: {availableAt: new Date(Date.now() - 1)}});
  const availableLedger = await affiliate.listAffiliateLedger({beneficiaryUserId: child.id});
  assert.equal(availableLedger.items[0].status, 'AVAILABLE');

  const partial = await fixture.db.$transaction(tx => affiliate.recordAffiliateRefundInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'coin-order-1', refundKey: 'refund-1-part', refundAmountCents: 2500}));
  assert.equal(partial?.reversedCommissionCents, 250);
  const repeated = await fixture.db.$transaction(tx => affiliate.recordAffiliateRefundInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'coin-order-1', refundKey: 'refund-1-part', refundAmountCents: 2500}));
  assert.equal(repeated?.id, partial?.id);
  await fixture.db.$transaction(tx => affiliate.recordAffiliateRefundInTransaction(tx, {sourceType: 'COIN', sourceOrderId: 'coin-order-1', refundKey: 'refund-1-rest', refundAmountCents: 7500}));
  const reversed = await fixture.db.affiliateAccrual.findUniqueOrThrow({where: {id: first!.id}});
  assert.equal(reversed.status, 'REVERSED'); assert.equal(reversed.reversedCents, 1000); assert.equal(reversed.refundedBaseCents, 10_000);
});
