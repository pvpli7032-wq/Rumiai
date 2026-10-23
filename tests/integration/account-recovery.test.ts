import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('password reset and email verification tokens are hashed, short-lived, one-time, and revoke sessions', async t => {
  process.env.ACCOUNT_EMAIL_DELIVERY = 'memory';
  const fixture = await createFixture();
  t.after(() => { delete process.env.ACCOUNT_EMAIL_DELIVERY; return fixture.cleanup(); });
  const messages: Array<{email: string; purpose: string; token: string; expiresAt: Date}> = [];
  const delivery = {deliver: async (message: (typeof messages)[number]) => { messages.push(message); }};
  const recovery = await import('@rumiai/backend/modules/accounts/account-recovery-service');
  const {loginWithPassword} = await import('@rumiai/backend/modules/accounts/login-service');
  const {getAuthUser, signToken} = await import('@rumiai/backend/infrastructure/auth/auth');
  const emailDelivery = await import('@rumiai/backend/infrastructure/email/account-email-delivery');
  const forgotRoute = await import('../../apps/api/src/app/api/auth/password/forgot/route');

  emailDelivery.clearDevelopmentAccountEmailOutbox();
  const knownResponse = await forgotRoute.POST(new Request('http://test.local/api/auth/password/forgot', {method: 'POST', headers: {'content-type': 'application/json', 'x-real-ip': '192.0.2.10'}, body: JSON.stringify({email: fixture.user.email})}));
  const unknownResponse = await forgotRoute.POST(new Request('http://test.local/api/auth/password/forgot', {method: 'POST', headers: {'content-type': 'application/json', 'x-real-ip': '192.0.2.11'}, body: JSON.stringify({email: 'unknown-route@example.test'})}));
  assert.equal(knownResponse.status, 202);
  assert.equal(unknownResponse.status, 202);
  assert.deepEqual(await knownResponse.json(), await unknownResponse.json(), 'route must not reveal whether an email exists');
  assert.equal(emailDelivery.readDevelopmentAccountEmailOutbox().length, 1);

  await recovery.requestPasswordReset('missing@example.test', delivery);
  assert.equal(messages.length, 0, 'unknown account must not produce a delivery');
  await recovery.requestPasswordReset(fixture.user.email.toUpperCase(), delivery);
  assert.equal(messages.length, 1);
  const reset = messages[0];
  const stored = await fixture.db.accountActionToken.findFirstOrThrow({where: {userId: fixture.user.id, purpose: 'PASSWORD_RESET'}});
  assert.notEqual(stored.tokenHash, reset.token, 'database must not contain the bearer token');
  assert.ok(stored.expiresAt.getTime() - stored.createdAt.getTime() <= 15 * 60_000 + 1_000);

  const oldBearer = await signToken({userId: fixture.user.id, email: fixture.user.email, tokenVersion: 0});
  await fixture.db.adminSession.create({data: {userId: fixture.user.id, tokenHash: 'recovery-test-admin-session', expiresAt: new Date(Date.now() + 60_000)}});
  const newPassword = 'Replacement-password-456!';
  await recovery.resetPassword(reset.token, newPassword);
  await assert.rejects(() => recovery.resetPassword(reset.token, newPassword), /无效|过期/);
  await assert.rejects(() => loginWithPassword({email: fixture.user.email, password: fixture.password}));
  assert.equal((await loginWithPassword({email: fixture.user.email, password: newPassword})).user.id, fixture.user.id);
  assert.equal(await fixture.db.adminSession.count({where: {userId: fixture.user.id}}), 0);
  assert.equal(await getAuthUser(new Request('http://test.local', {headers: {authorization: `Bearer ${oldBearer}`}})), null);

  await recovery.requestPasswordReset(fixture.user.email, delivery);
  const expired = messages.at(-1)!;
  await fixture.db.accountActionToken.update({where: {tokenHash: (await fixture.db.accountActionToken.findFirstOrThrow({where: {userId: fixture.user.id, purpose: 'PASSWORD_RESET', usedAt: null}})).tokenHash}, data: {expiresAt: new Date(Date.now() - 1)}});
  await assert.rejects(() => recovery.resetPassword(expired.token, 'Another-password-789!'), /无效|过期/);

  await recovery.requestEmailVerification(fixture.user.id, delivery);
  const verification = messages.at(-1)!;
  assert.equal(verification.purpose, 'EMAIL_VERIFICATION');
  await recovery.verifyEmail(verification.token);
  assert.ok((await fixture.db.user.findUniqueOrThrow({where: {id: fixture.user.id}})).emailVerifiedAt);
  await assert.rejects(() => recovery.verifyEmail(verification.token), /无效|过期/);

  delete process.env.ACCOUNT_EMAIL_DELIVERY;
  const unavailable = await forgotRoute.POST(new Request('http://test.local/api/auth/password/forgot', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: fixture.user.email})}));
  assert.equal(unavailable.status, 503, 'unconfigured delivery must not claim that email was sent');
});
