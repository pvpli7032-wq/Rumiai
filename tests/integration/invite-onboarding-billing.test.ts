import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('invite registration is explicit, onboarding is gated, and missing prices fail closed', async t => {
  process.env.JWT_SECRET = 'integration-only-jwt-secret-012345678901234567890123';
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());

  await fixture.db.operationSetting.upsert({
    where: {key: 'growth.inviteEnabled'},
    create: {key: 'growth.inviteEnabled', group: 'growth', value: 'true', updatedBy: fixture.admin.id},
    update: {value: 'true', updatedBy: fixture.admin.id},
  });
  await fixture.db.operationSetting.upsert({
    where: {key: 'growth.onboardingEnabled'},
    create: {key: 'growth.onboardingEnabled', group: 'growth', value: 'true', updatedBy: fixture.admin.id},
    update: {value: 'true', updatedBy: fixture.admin.id},
  });
  await fixture.db.user.update({where: {id: fixture.user.id}, data: {inviteCode: 'E2EINVITE'}});

  const {AccountRegistrationError, registerAccount} = await import('@rumiai/backend/modules/accounts/registration-service');
  await assert.rejects(
    registerAccount({name: '无效邀请', email: 'invalid-invite@example.test', password: fixture.password, inviteCode: 'DOESNOTEXIST'}),
    (error: unknown) => error instanceof AccountRegistrationError && error.status === 400 && /邀请码无效/.test(error.message),
  );
  assert.equal(await fixture.db.user.count({where: {email: 'invalid-invite@example.test'}}), 0);

  const registered = await registerAccount({name: '有效邀请', email: 'valid-invite@example.test', password: fixture.password, inviteCode: 'e2einvite'});
  assert.equal((await fixture.db.user.findUnique({where: {id: registered.id}, select: {invitedByUserId: true}}))?.invitedByUserId, fixture.user.id);

  const {shouldStartOnboarding} = await import('@rumiai/backend/modules/growth/onboarding-service');
  assert.equal(await shouldStartOnboarding(null), true);
  assert.equal(await shouldStartOnboarding(new Date()), false);

  const provider = await fixture.db.aiProvider.create({data: {name: 'unpriced-provider', baseUrl: 'http://127.0.0.1'}});
  const model = await fixture.db.aiModel.create({data: {key: 'unpriced-model', displayName: 'Unpriced model', modelCode: 'unpriced', providerId: provider.id, isActive: true, isDefault: true}});
  await fixture.db.operationSetting.upsert({
    where: {key: 'billing.chargingEnabled'},
    create: {key: 'billing.chargingEnabled', group: 'billing', value: 'true', updatedBy: fixture.admin.id},
    update: {value: 'true', updatedBy: fixture.admin.id},
  });
  const {quoteReplyPrice} = await import('@rumiai/backend/modules/billing/price');
  const {holdCharge, MissingModelPriceError} = await import('@rumiai/backend/modules/billing/charge-service');
  const quote = await quoteReplyPrice({userId: registered.id, operation: 'CHAT_SEND', modelKey: model.key});
  assert.equal(quote.pricing, 'NO_PRICE');
  await assert.rejects(
    holdCharge({userId: registered.id, requestId: 'missing-price-001', operation: 'CHAT_SEND', modelKey: model.key}),
    (error: unknown) => error instanceof MissingModelPriceError && error.code === 'MODEL_PRICE_NOT_CONFIGURED',
  );

  await fixture.db.operationSetting.upsert({
    where: {key: 'billing.priceMultiplier'},
    create: {key: 'billing.priceMultiplier', group: 'billing', value: '0', updatedBy: fixture.admin.id},
    update: {value: '0', updatedBy: fixture.admin.id},
  });
  const {clearKeyEverywhere} = await import('@rumiai/backend/modules/settings/cache');
  clearKeyEverywhere('billing.priceMultiplier');
  const freeQuote = await quoteReplyPrice({userId: registered.id, operation: 'CHAT_SEND', modelKey: model.key});
  assert.equal(freeQuote.pricing, 'FREE_MULTIPLIER');
  const freeHold = await holdCharge({userId: registered.id, requestId: 'explicit-free-001', operation: 'CHAT_SEND', modelKey: model.key});
  assert.equal(freeHold.held, false);
  assert.equal(freeHold.coins, 0);
});
