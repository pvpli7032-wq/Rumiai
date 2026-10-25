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

  await assert.rejects(
    () => recovery.resetPassword('not-a-real-reset-token', 'Replacement-password-456!'),
    /无效|过期/,
    'a random bearer token must not reveal whether it ever existed',
  );

  const oldBearer = await signToken({userId: fixture.user.id, email: fixture.user.email, tokenVersion: 0});
  await fixture.db.adminSession.create({data: {userId: fixture.user.id, tokenHash: 'recovery-test-admin-session', expiresAt: new Date(Date.now() + 60_000)}});
  const newPassword = 'Replacement-password-456!';
  const concurrent = await Promise.allSettled([
    recovery.resetPassword(reset.token, newPassword),
    recovery.resetPassword(reset.token, newPassword),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'a reset token must be claimed exactly once under concurrent use');
  assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
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
  const unavailableKnown = await forgotRoute.POST(new Request('http://test.local/api/auth/password/forgot', {method: 'POST', headers: {'content-type': 'application/json', 'x-real-ip': '192.0.2.12'}, body: JSON.stringify({email: fixture.user.email})}));
  const unavailableUnknown = await forgotRoute.POST(new Request('http://test.local/api/auth/password/forgot', {method: 'POST', headers: {'content-type': 'application/json', 'x-real-ip': '192.0.2.13'}, body: JSON.stringify({email: 'another-unknown@example.test'})}));
  assert.equal(unavailableKnown.status, 503, 'unconfigured delivery must not claim that email was sent');
  assert.equal(unavailableUnknown.status, 503);
  assert.deepEqual(await unavailableKnown.json(), await unavailableUnknown.json(), 'delivery configuration errors must not reveal whether an email exists');
});

test('transactional email validates configuration, sends the correct action, and sanitizes provider failure', async t => {
  const keys = ['NODE_ENV', 'ACCOUNT_EMAIL_DELIVERY', 'RESEND_API_KEY', 'ACCOUNT_EMAIL_FROM', 'NEXT_PUBLIC_SITE_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
  const email = await import('@rumiai/backend/infrastructure/email/account-email-delivery');
  Object.assign(process.env, {NODE_ENV: 'production', ACCOUNT_EMAIL_DELIVERY: 'memory'});
  assert.equal(email.accountEmailDeliveryConfigured(), false, 'memory delivery cannot be used in production');
  Object.assign(process.env, {ACCOUNT_EMAIL_DELIVERY: 'resend', RESEND_API_KEY: 'fixture-not-a-real-key', ACCOUNT_EMAIL_FROM: 'Accounts <accounts@example.test>', NEXT_PUBLIC_SITE_URL: 'http://example.test'});
  assert.equal(email.accountEmailDeliveryConfigured(), false, 'production recovery links require HTTPS');
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  assert.equal(email.accountEmailDeliveryConfigured(), true);
  const calls: Array<{url: string; body: Record<string, unknown>; key: string | null}> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.resend.com/emails', 'all email requests are intercepted; no real provider call');
    const headers = new Headers(init?.headers);
    calls.push({url: String(input), body: JSON.parse(String(init?.body)), key: headers.get('Idempotency-Key')});
    return Response.json({id: 'fixture-email-id'});
  };
  const message = {email: 'recipient@example.test', purpose: 'PASSWORD_RESET' as const, token: 'fixture-bearer-token', expiresAt: new Date('2030-01-01T00:00:00Z')};
  await email.accountEmailDelivery().deliver(message);
  await email.accountEmailDelivery().deliver(message);
  assert.deepEqual(calls[0].body.to, ['recipient@example.test']);
  assert.equal(calls[0].body.subject, '重置密码');
  assert.ok(String(calls[0].body.text).includes('https://example.test/reset-password?token=fixture-bearer-token'));
  assert.equal(calls[0].key, calls[1].key, 'same delivery is idempotent');
  assert.ok(!calls[0].key?.includes(message.token), 'idempotency key does not disclose the bearer token');
  for (const purpose of ['EMAIL_VERIFICATION', 'ACCOUNT_ACTIVATION'] as const) {
    await email.accountEmailDelivery().deliver({...message, purpose});
  }
  assert.ok(String(calls[2].body.text).includes('/verify-email?token='));
  assert.ok(String(calls[3].body.text).includes('/activate-account?token='));
  globalThis.fetch = async () => Response.json({message: 'provider may contain confidential diagnostics'}, {status: 401});
  await assert.rejects(() => email.accountEmailDelivery().deliver(message), error => {
    assert.equal((error as Error).message, 'Account email delivery failed');
    return true;
  });
});
