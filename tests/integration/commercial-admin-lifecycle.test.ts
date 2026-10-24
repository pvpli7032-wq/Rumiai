import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('managed account activation/soft-close and membership delete guards preserve history', async t => {
  process.env.ACCOUNT_EMAIL_DELIVERY = 'memory';
  const fixture = await createFixture(); t.after(() => {delete process.env.ACCOUNT_EMAIL_DELIVERY; return fixture.cleanup();});
  const email = await import('@rumiai/backend/infrastructure/email/account-email-delivery'); email.clearDevelopmentAccountEmailOutbox();
  const accounts = await import('@rumiai/backend/modules/accounts/management-service');
  const recovery = await import('@rumiai/backend/modules/accounts/account-recovery-service');
  const {loginWithPassword} = await import('@rumiai/backend/modules/accounts/login-service');
  const created = await accounts.createManagedAccount(fixture.admin.id, {email: 'managed-created@example.test', username: 'managed-created', displayName: '后台创建用户', reason: '隔离测试一次性激活'});
  const activation = email.readDevelopmentAccountEmailOutbox().at(-1)!; assert.equal(activation.purpose, 'ACCOUNT_ACTIVATION');
  const pending = await fixture.db.user.findUniqueOrThrow({where: {id: created.id}}); assert.ok(pending.suspendedAt); assert.equal(pending.emailVerifiedAt, null);
  await recovery.activateAccount(activation.token, 'Activated-password-123!');
  await assert.rejects(() => recovery.activateAccount(activation.token, 'Activated-password-123!'), /无效|过期/);
  assert.equal((await loginWithPassword({email: created.email, password: 'Activated-password-123!'})).user.id, created.id);
  const character = await fixture.db.character.create({data: {name: 'preserved-character', personality: 'test', background: 'test', creatorId: created.id}});
  const active = await fixture.db.user.findUniqueOrThrow({where: {id: created.id}});
  await accounts.updateManagedAccount(fixture.admin.id, created.id, {action: 'CLOSE', reason: '隔离测试软关闭', version: active.accountVersion});
  const closed = await fixture.db.user.findUniqueOrThrow({where: {id: created.id}}); assert.ok(closed.deletedAt); assert.ok(closed.suspendedAt);
  assert.equal((await fixture.db.character.findUniqueOrThrow({where: {id: character.id}})).creatorId, created.id, 'related business data is retained');
  await assert.rejects(() => loginWithPassword({email: created.email, password: 'Activated-password-123!'}));

  const memberships = await import('@rumiai/backend/modules/memberships/service');
  const removable = await memberships.saveMembershipPlan(fixture.admin.id, {code: 'REMOVABLE_TEST', name: '可删除测试套餐', durationDays: 7, priceCents: null, benefits: [], isActive: false, reason: '隔离测试新增套餐'});
  assert.deepEqual(await memberships.deleteMembershipPlan(fixture.admin.id, {id: removable.id, version: removable.version, reason: '隔离测试删除未售套餐'}), {id: removable.id, deleted: true});
  const referenced = await memberships.saveMembershipPlan(fixture.admin.id, {code: 'REFERENCED_TEST', name: '订单引用测试套餐', durationDays: 7, priceCents: 100, benefits: [], isActive: true, reason: '隔离测试订单保护'});
  await memberships.createMembershipOrder({userId: fixture.user.id, planCode: referenced.code, idempotencyKey: 'membership-delete-guard', orderNo: 'membership-delete-guard'});
  const disabled = await memberships.saveMembershipPlan(fixture.admin.id, {...referenced, isActive: false, reason: '隔离测试停用套餐'});
  await assert.rejects(() => memberships.deleteMembershipPlan(fixture.admin.id, {id: disabled.id, version: disabled.version, reason: '验证订单引用保护'}), /已有订单/);
  assert.ok(await fixture.db.membershipPlan.findUnique({where: {id: disabled.id}}));
});
