import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalizeEzfpParams,
  formatCnyCents,
  getEzfpCreateUrl,
  isEzfpConfigured,
  isSafePaymentRedirect,
  signEzfpParams,
  uniqueUrlParams,
  verifyEzfpParams,
} from '../src/lib/payments/ezfp-v2.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

test('EZFP V2 canonical fields are sorted and omit signature metadata and empty values', () => {
  assert.equal(
    canonicalizeEzfpParams({ z: 'last', sign: 'ignored', a: 'first', sign_type: 'RSA', blank: '', zero: '0' }),
    'a=first&z=last&zero=0'
  );
});

test('RSA SHA-256 signatures verify and reject changed values', () => {
  const params = { pid: '9001', money: '1.25', timestamp: '1791750000', sign_type: 'RSA' };
  const signed = { ...params, sign: signEzfpParams(params, privateKey) };
  assert.equal(verifyEzfpParams(signed, publicKey), true);
  assert.equal(verifyEzfpParams({ ...signed, money: '1.24' }, publicKey), false);
  assert.equal(verifyEzfpParams({ ...signed, sign_type: 'MD5' }, publicKey), false);
  assert.equal(verifyEzfpParams({ ...signed, sign: 'not-base64' }, publicKey), false);
});

test('signature transport tolerates a form parser that turned Base64 plus into spaces', () => {
  const params = { out_trade_no: 'KH123ABC', trade_status: 'TRADE_SUCCESS', sign_type: 'RSA' };
  const signature = signEzfpParams(params, privateKey);
  assert.equal(verifyEzfpParams({ ...params, sign: signature.replace(/\+/g, ' ') }, publicKey), true);
});

test('duplicate callback query parameters are rejected instead of ambiguously verified', () => {
  assert.deepEqual(uniqueUrlParams(new URL('https://local.test/notify?a=1&b=2')), { a: '1', b: '2' });
  assert.equal(uniqueUrlParams(new URL('https://local.test/notify?money=1.00&money=9.99')), null);
});

test('CNY cents require a positive safe integer and retain two decimal places', () => {
  assert.equal(formatCnyCents(1), '0.01');
  assert.equal(formatCnyCents(120), '1.20');
  assert.equal(formatCnyCents(12345), '123.45');
  assert.throws(() => formatCnyCents(0));
  assert.throws(() => formatCnyCents(1.5));
});

test('EZFP readiness requires explicit enablement and all server-only credentials', () => {
  assert.equal(isEzfpConfigured({ EZFP_PID: '1', EZFP_MERCHANT_PRIVATE_KEY: 'x', EZFP_PLATFORM_PUBLIC_KEY: 'y' }), false);
  assert.equal(isEzfpConfigured({
    NODE_ENV: 'development',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    EZFP_API_BASE_URL: 'http://127.0.0.1:4123',
    EZFP_ENABLED: 'true',
    EZFP_PID: '1',
    EZFP_MERCHANT_PRIVATE_KEY: 'x',
    EZFP_PLATFORM_PUBLIC_KEY: 'y',
  }), true);
});

test('local payment mock override and provider redirect URLs are constrained', () => {
  assert.equal(getEzfpCreateUrl({ NODE_ENV: 'development', EZFP_API_BASE_URL: 'http://127.0.0.1:4123' }), 'http://127.0.0.1:4123/api/pay/create');
  assert.throws(() => getEzfpCreateUrl({ NODE_ENV: 'development', EZFP_API_BASE_URL: 'https://attacker.example' }));
  assert.equal(isSafePaymentRedirect('https://pay.example.test/checkout/1', { NODE_ENV: 'production' }), true);
  assert.equal(isSafePaymentRedirect('javascript:alert(1)', { NODE_ENV: 'production' }), false);
  assert.equal(isSafePaymentRedirect('http://127.0.0.1:4000/pay', { NODE_ENV: 'development' }), true);
});
