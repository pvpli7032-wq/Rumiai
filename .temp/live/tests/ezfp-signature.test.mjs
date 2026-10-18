import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {normalizePaymentRsaCredentials, parsePaymentRsaKey} from '../src/lib/payments/rsa-credentials.ts';
import {
  canonicalizeEzfpParams,
  createEzfpCheckout,
  formatCnyCents,
  parseCnyCents,
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

const bare = pem => pem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, '');
test('payment keys accept platform Base64, PKCS1 and escaped PEM through signing', () => {
  for (const privateType of ['pkcs8', 'pkcs1']) {
    for (const publicType of ['spki', 'pkcs1']) {
      const keys = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: privateType, format: 'pem'}, publicKeyEncoding: {type: publicType, format: 'pem'}});
      for (const format of [value => value, bare, value => value.replace(/\n/g, '\\n')]) {
        const normalized = normalizePaymentRsaCredentials(format(keys.privateKey), format(keys.publicKey));
        assert.match(normalized.merchantPrivateKey, /^-----BEGIN PRIVATE KEY-----/);
        assert.match(normalized.platformPublicKey, /^-----BEGIN PUBLIC KEY-----/);
        const params = {pid: '9001', sign_type: 'RSA'};
        const signed = {...params, sign: signEzfpParams(params, format(keys.privateKey))};
        assert.equal(verifyEzfpParams(signed, format(keys.publicKey)), true);
        assert.equal(verifyEzfpParams(signed, normalized.platformPublicKey), true);
      }
    }
  }
});

test('payment keys reject wrong key kinds, malformed keys and weak RSA with field-specific errors', () => {
  for (const value of [publicKey, bare(publicKey), 'not-a-key']) assert.throws(() => parsePaymentRsaKey(value, 'private'), /商户私钥格式无效/);
  for (const value of [privateKey, bare(privateKey), 'not-a-key']) assert.throws(() => parsePaymentRsaKey(value, 'public'), /平台公钥格式无效/);
  const weak = generateKeyPairSync('rsa', {modulusLength: 1024, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
  assert.throws(() => normalizePaymentRsaCredentials(weak.privateKey, publicKey), /商户私钥必须为至少 2048/);
  assert.throws(() => normalizePaymentRsaCredentials(privateKey, weak.publicKey), /平台公钥必须为至少 2048/);
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

test('unsigned provider rejections explain failure but unsigned successes and tampered signatures stay rejected', async()=>{
  const original=globalThis.fetch;
  const env={EZFP_MERCHANT_PRIVATE_KEY:privateKey,EZFP_PLATFORM_PUBLIC_KEY:publicKey};
  const request={pid:'9001',method:'jump',type:'alipay'};
  try {
    globalThis.fetch=async()=>Response.json({code:-1,msg:'缺少支付方式'});
    await assert.rejects(()=>createEzfpCheckout(request,env),/支付平台未受理请求：缺少支付方式/);
    globalThis.fetch=async()=>Response.json({code:0,trade_no:'FAKE',pay_type:'jump',pay_info:'https://pay.invalid'});
    await assert.rejects(()=>createEzfpCheckout(request,env),/验签失败/);
    globalThis.fetch=async()=>Response.json({code:-1,msg:'forged',sign:'invalid',sign_type:'RSA'});
    await assert.rejects(()=>createEzfpCheckout(request,env),/验签失败/);
    const payload={code:'0',trade_no:'SIGNED',pay_type:'jump',pay_info:'https://pay.invalid'};
    const signature=signEzfpParams(payload,privateKey);
    globalThis.fetch=async()=>Response.json({...payload,sign:signature});
    assert.equal((await createEzfpCheckout(request,env)).tradeNo,'SIGNED');
  }finally{globalThis.fetch=original;}
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

test('provider amounts compare exact cents across decimal representations without rounding invalid amounts',()=>{
  for(const amount of ['1','1.0','1.00'])assert.equal(parseCnyCents(amount),100);
  assert.equal(parseCnyCents('1.25'),125);assert.equal(parseCnyCents('0.01'),1);
  assert.equal(parseCnyCents('90071992547409.91'),Number.MAX_SAFE_INTEGER);
  for(const amount of ['','0','0.00','1.001','1e0','+1','-1',' 1','1 ','1.','01','NaN','Infinity','90071992547409.92'])assert.equal(parseCnyCents(amount),null);
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
